const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');
const { Readable } = require('stream');

const { extractCsvDataFromLayouts, extractJsonDataFromLayouts } = require('./dataExtractor');


const contentDir = 'content';
const PrebuildlayoutsDir = 'prebuild/layouts'; // Updated to point to prebuild/layouts
const outputDir = 'public';
const dataDir = 'prebuild/data'; // Directory for JSON data sources
const partialsDir = 'partials';
const layoutsDir = 'layouts'; 

// Configuration for layouts, partials, JSON, and CSV
const config = {
    layouts: {
        include: [], // Specify layouts to include, e.g., 'base', 'single', 'list'
        exclude: []  // Specify layouts to exclude
    },
    partials: {
        include: [], // Specify partials to include
        exclude: []  // Specify partials to exclude
    },
    json: {
        include: [], // Specify JSON files to include "https://raw.githubusercontent.com/YuushaExa/v/refs/heads/main/Testcsvjson/data.json"
        exclude: []   // Specify JSON files to exclude
    },
    csv: {
        include: ["https://github.com/YuushaExa/v/releases/download/csvv2/wiki_movie_plots_deduped.csv"], // Specify CSV files to include "https://github.com/YuushaExa/v/releases/download/csvv2/wiki_movie_plots_deduped.csv"
        exclude: []   // Specify CSV files to exclude
    },
     pagination: {
        postsPerPage: 10 // Adjust this value as needed
    }
};


const layoutCache = {};
const partialCache = {};

// Function to read a file from a directory with caching
async function readFile(dir, name) {
    const cache = dir === layoutsDir ? layoutCache : partialCache;
    const filePath = `${dir}/${name}.html`;

    if (cache[name]) {
        return cache[name];
    }

    if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        cache[name] = content;
        return content;
    }

    return '';
}

// Function to preload layouts and partials based on config
async function preloadTemplates() {
    const layoutFiles = await fs.readdir(layoutsDir);
    for (const file of layoutFiles) {
        if (file.endsWith('.html')) {
            const layoutName = file.replace('.html', '');

            // Check include/exclude logic for layouts
            const shouldIncludeLayout =
                (config.layouts.include.length === 0 || config.layouts.include.includes(layoutName)) &&
                !config.layouts.exclude.includes(layoutName);

            if (shouldIncludeLayout) {
                layoutCache[layoutName] = await fs.readFile(`${layoutsDir}/${file}`, 'utf-8');
                console.log(`Preloaded layout: ${layoutName}`);
            } else {
                console.log(`Skipped layout: ${layoutName}`);
            }
        }
    }

    const partialFiles = await fs.readdir(partialsDir);
    for (const file of partialFiles) {
        if (file.endsWith('.html')) {
            const partialName = file.replace('.html', '');

            // Check include/exclude logic for partials
            const shouldIncludePartial =
                (config.partials.include.length === 0 || config.partials.include.includes(partialName)) &&
                !config.partials.exclude.includes(partialName);

            if (shouldIncludePartial) {
                partialCache[partialName] = await fs.readFile(`${partialsDir}/${file}`, 'utf-8');
                console.log(`Preloaded partial: ${partialName}`);
            } else {
                console.log(`Skipped partial: ${partialName}`);
            }
        }
    }
}


// Function to render a template with context and partials
async function renderTemplate(template, context = {}) {
    if (!template) return '';

        context.currentYear = new Date().getFullYear();

    // Render partials
    const partialMatches = [...template.matchAll(/{{>\s*([\w]+)\s*}}/g)];
    for (const match of partialMatches) {
        const [fullMatch, partialName] = match;
        const partialContent = partialCache[partialName] || await readFile(partialsDir, partialName);
        if (partialContent) {
            template = template.replace(fullMatch, partialContent);
        } else {
            console.warn(`Partial not found: ${partialName}`);
        }
    }

    // Render loops
    const loopMatches = [...template.matchAll(/{{#each\s+([\w]+)}}([\s\S]*?){{\/each}}/g)];
    for (const match of loopMatches) {
        const [fullMatch, collection, innerTemplate] = match;
        const items = context[collection];
        if (Array.isArray(items)) {
            const renderedItems = await Promise.all(
                items.map(item => renderTemplate(innerTemplate, { ...context, ...item }))
            );
                       template = template.replace(fullMatch, renderedItems.join(''));
        } else {
            template = template.replace(fullMatch, '');
        }
    }

    // Render conditionals
    const conditionalMatches = [...template.matchAll(/{{#if\s+([\w]+)}}([\s\S]*?){{\/if}}/g)];
    for (const match of conditionalMatches) {
        const [fullMatch, condition, innerTemplate] = match;
        template = template.replace(fullMatch, context[condition] ? innerTemplate : '');
    }

    // Render variables
    const variableMatches = [...template.matchAll(/{{\s*([\w]+)\s*}}/g)];
    for (const match of variableMatches) {
        const [fullMatch, key] = match;
        template = template.replace(fullMatch, context[key] || '');
    }

    return template;
}

async function renderWithBase(templateContent, context = {}) {
    const baseTemplate = layoutCache['base'] || await readFile(layoutsDir, 'base');
    return await renderTemplate(baseTemplate, { ...context, content: templateContent });
}

async function generateSingleHTML(title, content, fileName) {
    const finalTitle = title || fileName.replace('.md', '').replace(/-/g, ' ');
    const singleTemplate = layoutCache['single'] || await readFile(layoutsDir, 'single');
    const renderedContent = await renderTemplate(singleTemplate, { title: finalTitle, content });
    return await renderWithBase(renderedContent, { title: finalTitle });
}

async function generateIndex(posts, pageNumber = 1) {
    const postsPerPage = config.pagination.postsPerPage;
    const totalPages = Math.ceil(posts.length / postsPerPage);
    
    // Slice the posts array to get the current page's posts
    const pagePosts = posts.slice((pageNumber - 1) * postsPerPage, pageNumber * postsPerPage);
    
    const listTemplate = layoutCache['list'] || await readFile(layoutsDir, 'list');
    const indexTemplate = layoutCache['index'] || await readFile(layoutsDir, 'index');

    // Render the list of posts for the current page
    const listHTML = await renderTemplate(listTemplate, { posts: pagePosts });

    // Calculate previous and next page links
    const prevPage = pageNumber > 1 ? `/yuushacms/index-${pageNumber - 1}.html` : null;
    const nextPage = pageNumber < totalPages ? `/yuushacms/index-${pageNumber + 1}.html` : null;

    const renderedContent = await renderTemplate(indexTemplate, { 
        list: listHTML, 
        currentPage: pageNumber,
        totalPages: totalPages,
        prevPage: prevPage,
        nextPage: nextPage
    });
    
    return await renderWithBase(renderedContent, { title: 'Home' });
}


// Function to generate pagination links
function generatePaginationLinks(currentPage, totalPages) {
    let links = '';

    // Previous Page Link
    if (currentPage > 1) {
        links += `<a href="/yuushacms/index${currentPage - 1 === 1 ? '' : `-${currentPage - 1}`}.html">Previous</a> `;
    }

    // Page Number Links
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentPage) {
            links += `<strong>${i}</strong> `;
        } else {
            links += `<a href="/yuushacms/index-${i}.html">${i}</a> `;
        }
    }

    // Next Page Link
    if (currentPage < totalPages) {
        links += `<a href="/yuushacms/index-${currentPage + 1}.html">Next</a>`;
    }

    return links;
}


// Main content processing function
async function processContent() {
    await extractJsonDataFromLayouts(config);
    await extractCsvDataFromLayouts(config);
    
    const files = await fs.readdir(contentDir);
    const markdownFiles = [];

    // Traverse through the content directory
    for (const file of files) {
        const fullPath = `${contentDir}/${file}`;
        const stats = await fs.stat(fullPath);

        if (stats.isDirectory()) {
            const nestedFiles = await fs.readdir(fullPath);
            nestedFiles.forEach(nestedFile => {
                if (nestedFile.endsWith('.md')) {
                    markdownFiles.push(`${file}/${nestedFile}`);
                }
            });
        } else if (stats.isFile() && file.endsWith('.md')) {
            markdownFiles.push(file);
        }
    }

    await fs.ensureDir(outputDir);

    const posts = [];
    const skippedEntries = [];
    const startTime = Date.now();

    let totalPostDuration = 0; // Initialize total post duration
    let postCount = 0; // Initialize post count

    // Process all collected markdown files
    for (const file of markdownFiles) {
        const postStartTime = Date.now(); // Start time for post creation
        const content = await fs.readFile(`${contentDir}/${file}`, 'utf-8');
        const { data, content: mdContent } = matter(content);
        const htmlContent = marked(mdContent);

        if (!data.title) {
            skippedEntries.push({ title: file.replace('.md', ''), link: `${file.replace('.md', '')}.html` });
            continue;
        }

        const html = await generateSingleHTML(data.title, htmlContent, file);

        const slug = file.replace('.md', '');
        const outputFilePath = path.join(outputDir, `${slug}.html`);
        const outputDirPath = path.dirname(outputFilePath);
        await fs.ensureDir(outputDirPath);

        await fs.writeFile(outputFilePath, html);

        const postTitle = data.title || slug.replace(/-/g, ' ');
        posts.push({ title: postTitle, url: `${slug}.html` });

        const postEndTime = Date.now(); // End time for post creation
        const postDuration = (postEndTime - postStartTime) / 1000; // Duration in seconds
        totalPostDuration += postDuration; // Accumulate total post duration
        postCount++; // Increment post count

    }

    // Generate paginated index pages
    const postsPerPage = config.pagination.postsPerPage;
    const totalPages = Math.ceil(posts.length / postsPerPage);
    const pageStartTime = Date.now(); // Start time for page creation

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
        const indexHTML = await generateIndex(posts, pageNumber);
        const pageFileName = pageNumber === 1 ? 'index.html' : `index-${pageNumber}.html`;
        await fs.writeFile(`${outputDir}/${pageFileName}`, indexHTML);
    }

    const pageEndTime = Date.now(); // End time for page creation
    const pageDuration = (pageEndTime - pageStartTime) / 1000; // Duration in seconds

    const totalEndTime = Date.now();
    const totalElapsed = ((totalEndTime - startTime) / 1000).toFixed(4);

    console.log('--- Build Statistics ---');
    console.log(`Total Entries Processed: ${markdownFiles.length}`);
    console.log(`Total Posts Created: ${posts.length}`);
    console.log(`Total Pages Created: ${totalPages}`);
    
    if (postCount > 0) {
        console.log(`Average Time per Post: ${(totalPostDuration / postCount).toFixed(4)} seconds`);
    } else {
        console.log(`No posts were created.`);
    }
    
    console.log(`Total Time for Page Creation: ${pageDuration.toFixed(4)} seconds`);
    
    if (skippedEntries.length > 0) {
        console.log(`Skipped Entries:`);
        skippedEntries.forEach(entry => {
            console.log(`- Title: ${entry.title}, Link: ${entry.link}`);
        });
    } else {
        console.log(`No entries were skipped.`);
    }
}



// Main SSG execution
async function runSSG() {
    console.log('--- Starting Static Site Generation ---');
    await preloadTemplates();
    await processContent();
}

// Execute the static site generator
runSSG().catch(error => {
    console.error('Error during static site generation:', error);
});

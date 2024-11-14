const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');
const { Readable } = require('stream');

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
        include: [], // Specify CSV files to include "https://github.com/YuushaExa/v/releases/download/csvv2/wiki_movie_plots_deduped.csv"
        exclude: []   // Specify CSV files to exclude
    }
};

const POSTS_PER_PAGE = 1; // Change this to the desired number of posts per page

// Function to generate pagination links
function generatePagination(currentPage, totalPages) {
    const context = {
        currentPage: currentPage,
        totalPages: totalPages,
        prevPageLink: currentPage > 1 ? `index-${currentPage - 1}.html` : null,
        nextPageLink: currentPage < totalPages ? `index-${currentPage + 1}.html` : null
    };

    return context;
}

// Function to preload layouts and partials based on config
const layoutCache = {};
const partialCache = {};

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
const helpers = {
    gt: (a, b) => a > b,
    lt: (a, b) => a < b,
    add: (a, b) => a + b,
    subtract: (a, b) => a - b
};

async function renderTemplate(template, context = {}) {
    if (!template) return '';

    // Default prevPageLink and nextPageLink if not set
    context.prevPageLink = context.prevPageLink || '';
    context.nextPageLink = context.nextPageLink || '';

    // Add default current year to context
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
    const conditionalMatches = [...template.matchAll(/{{#if\s+([\s\S]+?)}}([\s\S]*?){{\/if}}/g)];
    for (const match of conditionalMatches) {
        const [fullMatch, condition, innerTemplate] = match;
        const evaluatedCondition = evaluateCondition(condition, context);
        template = template.replace(fullMatch, evaluatedCondition ? innerTemplate : '');
    }

    // Render variables
    const variableMatches = [...template.matchAll(/{{\s*([\w]+)\s*}}/g)];
    for (const match of variableMatches) {
        const [fullMatch, key] = match;
        template = template.replace(fullMatch, context[key] || '');
    }

    return template;
}

// Function to generate index HTML with pagination
async function generateIndex(posts, pageNumber = 1) {
    const listTemplate = layoutCache['list'] || await readFile(layoutsDir, 'list');
    const indexTemplate = layoutCache['index'] || await readFile(layoutsDir, 'index');

    // Calculate the start and end index for the posts to display on this page
    const startIndex = (pageNumber - 1) * POSTS_PER_PAGE;
    const endIndex = startIndex + POSTS_PER_PAGE;
    const paginatedPosts = posts.slice(startIndex, endIndex);

    const listHTML = await renderTemplate(listTemplate, { posts: paginatedPosts });
    const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);

    // Generate pagination context
    const paginationContext = generatePagination(pageNumber, totalPages);

    const renderedContent = await renderTemplate(indexTemplate, {
        list: listHTML,
        pageNumber,
        totalPages,
        prevPageLink: paginationContext.prevPageLink,
        nextPageLink: paginationContext.nextPageLink,
        currentPage: pageNumber
    });

    return await renderWithBase(renderedContent, { title: `Home - Page ${pageNumber}` });
}

// Function to render with base layout
async function renderWithBase(templateContent, context = {}) {
    const baseTemplate = layoutCache['base'] || await readFile(layoutsDir, 'base');
    return await renderTemplate(baseTemplate, { ...context, content: templateContent });
}

// Main content processing function
async function processContent() {
    const files = await fs.readdir(contentDir);

    const markdownFiles = [];
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
    const startTime = Date.now(); // Start total build time tracking
    for (const file of markdownFiles) {
        const filePath = path.join(contentDir, file);
        const fileContents = await fs.readFile(filePath, 'utf-8');
        const { content, data } = matter(fileContents);

        const post = {
            title: data.title,
            date: data.date,
            slug: path.basename(file, '.md'),
            content: marked(content)
        };

        posts.push(post);
    }

    // Create paginated index pages
    const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
    for (let page = 1; page <= totalPages; page++) {
        const pageHTML = await generateIndex(posts, page);
        const outputFilePath = path.join(outputDir, page === 1 ? 'index.html' : `index-${page}.html`);
        await fs.writeFile(outputFilePath, pageHTML);
    }

    const endTime = Date.now(); // End build time tracking
    console.log(`Build complete in ${((endTime - startTime) / 1000).toFixed(2)} seconds.`);
}

// Start the processing of content
(async () => {
    await preloadTemplates();
    await processContent();
})();

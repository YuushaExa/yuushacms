const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');
const path = require('path');
const { extractDataFromSources } = require('./dataExtractor');

const contentDir = 'content';
const PrebuildlayoutsDir = 'prebuild/layouts'; // Not used directly, kept for consistency if needed
const outputDir = 'public';
const dataDir = 'prebuild/data'; // Not used directly, kept for consistency if needed
const partialsDir = 'partials';
const layoutsDir = 'layouts';

// Configuration
const config = {
    layouts: {
        include: [], // Specify layouts to include, e.g., 'base', 'single', 'list'
        exclude: []  // Specify layouts to exclude
    },
    partials: {
        include: [],
        exclude: []
    },
    json: { // Currently handled by extractDataFromSources
        include: [], 
        exclude: []
    },
    csv: { // Currently handled by extractDataFromSources
        include: ["https://github.com/YuushaExa/v/releases/download/csvv2/wiki_movie_plots_deduped.csv"], // Specify CSV files to include "https://github.com/YuushaExa/v/releases/download/csvv2/wiki_movie_plots_deduped.csv"
        exclude: []
    },
    pagination: {
        postsPerPage: 10
    }
};

const layoutCache = {};
const partialCache = {};

// Reads a file, caches the content, and handles errors
async function readAndCacheFile(dir, name) {
    const cache = dir === layoutsDir ? layoutCache : partialCache;
    const filePath = path.join(dir, `${name}.html`);

    if (cache[name]) {
        return cache[name];
    }

    try {
        if (await fs.pathExists(filePath)) {
            const content = await fs.readFile(filePath, 'utf-8');
            cache[name] = content;
            return content;
        }
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
    }

    return '';
}

// Preloads layouts and partials into the cache based on config
async function preloadTemplates() {
    try {
        const layoutFiles = await fs.readdir(layoutsDir);
        await Promise.all(layoutFiles.map(async (file) => {
            if (file.endsWith('.html')) {
                const layoutName = path.basename(file, '.html');
                if (config.layouts.include.length === 0 || config.layouts.include.includes(layoutName) && !config.layouts.exclude.includes(layoutName)) {
                    layoutCache[layoutName] = await fs.readFile(path.join(layoutsDir, file), 'utf-8');
                    console.log(`Preloaded layout: ${layoutName}`);
                } else {
                    console.log(`Skipped layout: ${layoutName}`);
                }
            }
        }));

        const partialFiles = await fs.readdir(partialsDir);
        await Promise.all(partialFiles.map(async (file) => {
            if (file.endsWith('.html')) {
                const partialName = path.basename(file, '.html');
                if (config.partials.include.length === 0 || config.partials.include.includes(partialName) && !config.partials.exclude.includes(partialName)) {
                    partialCache[partialName] = await fs.readFile(path.join(partialsDir, file), 'utf-8');
                    console.log(`Preloaded partial: ${partialName}`);
                } else {
                    console.log(`Skipped partial: ${partialName}`);
                }
            }
        }));
    } catch (error) {
        console.error('Error preloading templates:', error);
    }
}

// Renders a template with context, partials, loops, conditionals, and variables
async function renderTemplate(template, context = {}) {
    if (!template) return '';

    context.currentYear = new Date().getFullYear();

    try {
        // Render partials
        const partialMatches = [...template.matchAll(/{{>\s*([\w]+)\s*}}/g)];
        for (const match of partialMatches) {
            const [fullMatch, partialName] = match;
            const partialContent = partialCache[partialName] || await readAndCacheFile(partialsDir, partialName);
            if (partialContent) {
                template = template.replace(fullMatch, await renderTemplate(partialContent, context)); // Recursive rendering
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
                const renderedItems = await Promise.all(items.map(item => renderTemplate(innerTemplate, { ...context, ...item })));
                template = template.replace(fullMatch, renderedItems.join(''));
            } else {
                template = template.replace(fullMatch, '');
            }
        }

        // Render conditionals
        const conditionalMatches = [...template.matchAll(/{{#if\s+([\w]+)}}([\s\S]*?){{\/if}}/g)];
        for (const match of conditionalMatches) {
            const [fullMatch, condition, innerTemplate] = match;
            template = template.replace(fullMatch, context[condition] ? await renderTemplate(innerTemplate, context) : ''); // Recursive rendering
        }

        // Render variables
        const variableMatches = [...template.matchAll(/{{\s*([\w.-]+)\s*}}/g)];
        for (const match of variableMatches) {
            const [fullMatch, key] = match;
            const value = context[key] !== undefined ? context[key] : ''; // Handle nested properties
            template = template.replace(fullMatch, value);
        }
    } catch (error) {
        console.error('Error rendering template:', error);
        return ''; // Return empty string on error
    }

    return template;
}

// Renders content with a base layout
async function renderWithBase(templateContent, context = {}) {
    const baseTemplate = layoutCache['base'] || await readAndCacheFile(layoutsDir, 'base');
    return renderTemplate(baseTemplate, { ...context, content: templateContent });
}

// Generates a single HTML page
async function generateSingleHTML(title, content, fileName, context = {}) {
    const finalTitle = title || path.basename(fileName, '.md').replace(/-/g, ' ');
    const singleTemplate = layoutCache['single'] || await readAndCacheFile(layoutsDir, 'single');
    const mergedContext = { ...context, title: finalTitle, content };
    const renderedContent = await renderTemplate(singleTemplate, mergedContext);
    return renderWithBase(renderedContent, { title: finalTitle });
}

// Generates an index page with pagination
async function generateIndex(postSlices, pageNumber, totalPages) {
    const pagePosts = postSlices[pageNumber - 1];
    const listTemplate = layoutCache['list'] || await readAndCacheFile(layoutsDir, 'list');
    const indexTemplate = layoutCache['index'] || await readAndCacheFile(layoutsDir, 'index');
    const listHTML = await renderTemplate(listTemplate, { posts: pagePosts });

    const prevPage = pageNumber > 1 ? `/yuushacms/index-${pageNumber - 1}.html` : null;
    const nextPage = pageNumber < totalPages ? `/yuushacms/index-${pageNumber + 1}.html` : null;

    const renderedContent = await renderTemplate(indexTemplate, {
        list: listHTML,
        currentPage: pageNumber,
        totalPages: totalPages,
        prevPage: prevPage,
        nextPage: nextPage
    });

    return renderWithBase(renderedContent, { title: 'Home' });
}

// Extracts tag types from layout files
async function extractTagTypesFromLayouts() {
    const tagTypes = new Set();
    try {
        const layoutFiles = await fs.readdir(layoutsDir);
        await Promise.all(layoutFiles.map(async (file) => {
            if (file.endsWith('.html')) {
                const content = await fs.readFile(path.join(layoutsDir, file), 'utf-8');
                const regex = /<a href="\/tags\/([\w]+)\//g;
                let match;
                while ((match = regex.exec(content)) !== null) {
                    tagTypes.add(match[1]);
                }
            }
        }));
    } catch (error) {
        console.error('Error extracting tag types:', error);
    }
    return Array.from(tagTypes);
}

// Sanitizes tag values for URLs and filenames
function sanitizeTagValue(tagValue) {
    const maxLength = 50;
    const truncated = tagValue.length > maxLength ? tagValue.substring(0, maxLength) + "..." : tagValue;
    return encodeURIComponent(truncated.toLowerCase().replace(/\s+/g, '-'));
}

// Generates tag pages with pagination
async function generateTagPages(tagData) {
    const tagTemplate = layoutCache['tag'] || await readAndCacheFile(layoutsDir, 'tag');

    const tagPagePromises = [];
    for (const tagType in tagData) {
        for (const tagValue in tagData[tagType]) {
            const posts = tagData[tagType][tagValue];
            const totalPages = Math.ceil(posts.length / config.pagination.postsPerPage);
            const sanitizedTagValue = sanitizeTagValue(tagValue);

            for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
                tagPagePromises.push((async () => {
                    const pagePosts = posts.slice((pageNumber - 1) * config.pagination.postsPerPage, pageNumber * config.pagination.postsPerPage);
                    const prevPage = pageNumber > 1 ? `/tags/${tagType}/${sanitizedTagValue}/page-${pageNumber - 1}.html` : null;
                    const nextPage = pageNumber < totalPages ? `/tags/${tagType}/${sanitizedTagValue}/page-${pageNumber + 1}.html` : null;
                    const pageFileName = pageNumber === 1 ? 'index.html' : `page-${pageNumber}.html`;

                    const renderedContent = await renderTemplate(tagTemplate, {
                        tagType: tagType,
                        tagValue: tagValue,
                        posts: pagePosts,
                        prevPage: prevPage,
                        nextPage: nextPage
                    });

                    const tagPageDir = path.join(outputDir, 'tags', tagType, sanitizedTagValue);
                    await fs.ensureDir(tagPageDir);
                    const outputFilePath = path.join(tagPageDir, pageFileName);
                    await fs.writeFile(outputFilePath, await renderWithBase(renderedContent, { title: `Tag: ${tagValue}` }));
                })());
            }
        }
    }
    await Promise.all(tagPagePromises);
}

// Processes markdown content and generates HTML pages
async function processContent(extractedData, tagTypes) {
    const markdownFiles = await collectMarkdownFiles(contentDir);
    await fs.ensureDir(outputDir);

    const posts = [];
    const skippedEntries = [];

    const { postPromises, tagData } = await processMarkdownFiles(markdownFiles, tagTypes, posts, skippedEntries);
    await Promise.all(postPromises);
    await generateTagPages(tagData);

    const { pagePromises, totalPages } = await generatePaginatedIndex(posts);
    await Promise.all(pagePromises);

    logBuildStatistics(markdownFiles, posts, skippedEntries, totalPages, tagData, extractedData);
}

// Collects markdown files recursively from a directory
async function collectMarkdownFiles(dir) {
    const files = await fs.readdir(dir);
    const markdownFiles = [];

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stats = await fs.stat(fullPath);

        if (stats.isDirectory()) {
            markdownFiles.push(...await collectMarkdownFiles(fullPath));
        } else if (stats.isFile() && file.endsWith('.md')) {
            markdownFiles.push(path.relative(contentDir, fullPath));
        }
    }

    return markdownFiles;
}

// Processes collected markdown files
async function processMarkdownFiles(markdownFiles, tagTypes, posts, skippedEntries) {
    const startTime = Date.now();
    let totalPostDuration = 0;
    let postCount = 0;
    const tagData = {};
    const postPromises = markdownFiles.map(async (file) => {
        const postStartTime = Date.now();
        try {
            const content = await fs.readFile(path.join(contentDir, file), 'utf-8');
            const { data, content: mdContent } = matter(content);
            const htmlContent = marked(mdContent);

            if (!data.title) {
                skippedEntries.push({ title: file.replace('.md', ''), link: `${file.replace('.md', '')}.html` });
                return;
            }

            const context = { ...data, content: htmlContent };
            const html = await generateSingleHTML(data.title, htmlContent, file, context);
            const slug = file.replace('.md', '');
            const outputFilePath = path.join(outputDir, `${slug}.html`);
            await fs.ensureDir(path.dirname(outputFilePath));
            await fs.writeFile(outputFilePath, html);

            const postTitle = data.title || slug.replace(/-/g, ' ');
            posts.push({ title: postTitle, url: `${slug}.html` });

            tagTypes.forEach(tagType => {
                if (data[tagType]) {
                    const tagValues = Array.isArray(data[tagType]) ? data[tagType] : [data[tagType]];
                    tagValues.forEach(tagValue => {
                        const sanitizedTagValue = sanitizeTagValue(tagValue);
                        if (!tagData[tagType]) tagData[tagType] = {};
                        if (!tagData[tagType][sanitizedTagValue]) tagData[tagType][sanitizedTagValue] = [];
                        tagData[tagType][sanitizedTagValue].push({ title: postTitle, url: `${slug}.html` });
                    });
                }
            });
        } catch (error) {
            console.error(`Error processing file ${file}:`, error);
        } finally {
            const postEndTime = Date.now();
            const postDuration = (postEndTime - postStartTime) / 1000;
            totalPostDuration += postDuration;
            postCount++;
        }
    });
    return { postPromises, tagData, startTime, totalPostDuration, postCount };
}

// Generates paginated index pages
async function generatePaginatedIndex(posts) {
    const postsPerPage = config.pagination.postsPerPage;
    const totalPages = Math.ceil(posts.length / postsPerPage);
    const pageStartTime = Date.now();
    const postSlices = [];

    for (let i = 0; i < totalPages; i++) {
        postSlices.push(posts.slice(i * postsPerPage, (i + 1) * postsPerPage));
    }

    const pagePromises = [];
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
        pagePromises.push((async () => {
            const indexHTML = await generateIndex(postSlices, pageNumber, totalPages);
            const pageFileName = pageNumber === 1 ? 'index.html' : `index-${pageNumber}.html`;
            await fs.writeFile(path.join(outputDir, pageFileName), indexHTML);
        })());
    }
    return { pagePromises, totalPages, pageStartTime };
}

// Logs build statistics
function logBuildStatistics(markdownFiles, posts, skippedEntries, totalPages, tagData, extractedData) {
    const { startTime, totalPostDuration, postCount } = extractedData;
    const dataDuration = extractedData.dataDuration;
    const totalEndTime = Date.now();
    const totalElapsed = ((totalEndTime - startTime) / 1000).toFixed(5);
    const averageTimePerPage = totalPages > 0 ? (extractedData.pageDuration / totalPages).toFixed(4) : 0;

    console.log('--- Build Statistics ---');
    console.log(`Total Entries Processed: ${markdownFiles.length}`);
    console.log(`Total Posts Created: ${posts.length}`);
    console.log(`Total Pages Created: ${totalPages}`);
    console.log(`Time taken to process data: ${dataDuration} seconds`);
    console.log(`Average Time per Post: ${postCount > 0 ? (totalPostDuration / postCount).toFixed(5) : 0} seconds`);
    console.log(`Average Time per Page: ${averageTimePerPage} seconds`);
    console.log(`Skipped Entries: ${skippedEntries.length > 0 ? '' : 'None'}`);
    skippedEntries.forEach(entry => console.log(`- Title: ${entry.title}, Link: ${entry.link}`));
    console.log(`Total Build Time: ${totalElapsed} seconds`);
}

// Main SSG execution
async function runSSG() {
    console.log('--- Starting Static Site Generation ---');
    await preloadTemplates();
    const tagTypes = await extractTagTypesFromLayouts();
    const dataStartTime = Date.now();
    const extractedData = await extractDataFromSources(config);
    const dataEndTime = Date.now();
    extractedData.dataDuration = (dataEndTime - dataStartTime) / 1000;
    await processContent(extractedData, tagTypes);
}

console.time('runSSG Execution');
runSSG().then(() => {
    console.timeEnd('runSSG Execution');
}).catch(error => {
    console.error('Error during static site generation:', error);
});

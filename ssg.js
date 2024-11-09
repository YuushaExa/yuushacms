const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');

const contentDir = 'content';
const layoutsDir = 'layouts';
const partialsDir = 'partials';
const outputDir = 'public';

// Configuration for layouts and partials
const config = {
    layouts: {
        include: [], // Specify layouts to include, e.g., 'base', 'single', 'list'
        exclude: ['base', 'single', 'list', 'index']  // Specify layouts to exclude
    },
    partials: {
        include: [], // Specify partials to include
        exclude: ['head', 'footer', 'navbar']  // Specify partials to exclude
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

// Function to preload all layouts and partials
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

    const partialMatches = [...template.matchAll(/{{>\s*([\w]+)\s*}}/g)];
    for (const match of partialMatches) {
        const [fullMatch, partialName] = match;
        const partialContent = partialCache[partialName] || await readFile(partialsDir, partialName);
        template = template.replace(fullMatch, partialContent || '');
    }

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

    const conditionalMatches = [...template.matchAll(/{{#if\s+([\w]+)}}([\s\S]*?){{\/if}}/g)];
    for (const match of conditionalMatches) {
        const [fullMatch, condition, innerTemplate] = match;
        template = template.replace(fullMatch, context[condition] ? innerTemplate : '');
    }

    const variableMatches = [...template.matchAll(/{{\s*([\w]+)\s*}}/g)];
    for (const match of variableMatches) {
        const [fullMatch, key] = match;
        template = template.replace(fullMatch, context[key] || '');
    }

    return template;
}

async function renderWithBase(templateContent, context = {}) {
    const baseTemplate = layoutCache['base'] || await readFile(layoutsDir, 'base');
    return await renderTemplate(baseTemplate, { ...context, content: templateContent, currentYear: new Date().getFullYear() });
}

async function generateSingleHTML(title, content) {
    const singleTemplate = layoutCache['single'] || await readFile(layoutsDir, 'single');
    const renderedContent = await renderTemplate(singleTemplate, { title, content });
    return await renderWithBase(renderedContent, { title });
}

async function generateIndex(posts) {
    const listTemplate = layoutCache['list'] || await readFile(layoutsDir, 'list');
    const indexTemplate = layoutCache['index'] || await readFile(layoutsDir, 'index');
    const listHTML = await renderTemplate(listTemplate, { posts });
    const renderedContent = await renderTemplate(indexTemplate, { list: listHTML });
    return await renderWithBase(renderedContent, { title: 'Home' });
}

async function processContent() {
    const files = await fs.readdir(contentDir);
    const markdownFiles = files.filter(file => file.endsWith('.md'));

    await fs.ensureDir(outputDir);

    const posts = [];
    const timings = [];
    const startTime = Date.now();

    const postPromises = markdownFiles.map(async (file) => {
        const postFile = `${contentDir}/${file}`;
        const postStartTime = Date.now();
        try {
            const fileContent = await fs.readFile(postFile, 'utf-8');
            const { data, content } = matter(fileContent);
            const title = data.title || file.replace('.md', '');
            const slug = data.slug || title.replace(/\s+/g, '-').toLowerCase();
            const postURL = `${slug}.html`;
            const htmlContent = marked(content);

            const html = await generateSingleHTML(title, htmlContent);
            await fs.writeFile(`${outputDir}/${postURL}`, html);
            posts.push({ title, url: postURL });

            const endTime = Date.now();
            const elapsed = ((endTime - postStartTime) / 1000).toFixed(2);
            console.log(`Generated: ${postURL} in ${elapsed} seconds`);
            timings.push(elapsed);
        } catch (err) {
            console.error(`Error processing file ${postFile}:`, err);
        }
    });

    await Promise.all(postPromises);

    const indexHTML = await generateIndex(posts);
    await fs.writeFile(`${outputDir}/index.html`, indexHTML);

    const totalEndTime = Date.now();
    const totalElapsed = ((totalEndTime - startTime) / 1000).toFixed(2);
    console.log('--- Build Statistics ---');
    console.log(`Total Posts Generated: ${posts.length}`);
    console.log(`Total Build Time: ${totalElapsed} seconds`);
    console.log(`Average Time per Post: ${(timings.reduce((a, b) => parseFloat(a) + parseFloat(b), 0) / timings.length).toFixed(2)} seconds`);
}

// Main function to run the SSG
async function runSSG() {
    console.log('--- Starting Static Site Generation ---');
    await preloadTemplates();
    await processContent();
}

runSSG();

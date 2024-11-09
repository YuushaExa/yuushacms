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
        exclude: []  // Specify layouts to exclude
    },
    partials: {
        include: [], // Specify partials to include
        exclude: []  // Specify partials to exclude
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
async function preloadTemplates() {
    // Preload layouts
    const layoutFiles = await fs.readdir(layoutsDir);
    for (const file of layoutFiles) {
        if (file.endsWith('.html')) {
            const layoutName = file.replace('.html', '');
            layoutCache[layoutName] = await fs.readFile(`${layoutsDir}/${file}`, 'utf-8');
            console.log(`Preloaded layout: ${layoutName}`);
        }
    }

    // Preload partials
    const partialFiles = await fs.readdir(partialsDir);
    for (const file of partialFiles) {
        if (file.endsWith('.html')) {
            const partialName = file.replace('.html', '');
            partialCache[partialName] = await fs.readFile(`${partialsDir}/${file}`, 'utf-8');
            console.log(`Preloaded partial: ${partialName}`);
        }
    }
}

// Function to render a template with context and partials
async function renderTemplate(template, context = {}) {
    if (!template) return '';

    // Step 1: Replace partials
    const partialMatches = [...template.matchAll(/{{>\s*([\w]+)\s*}}/g)];
    for (const match of partialMatches) {
        const [fullMatch, partialName] = match;

        if (config.partials.include.length > 0 && !config.partials.include.includes(partialName)) {
            continue;
        }
        if (config.partials.exclude.includes(partialName)) {
            continue;
        }

        const partialContent = partialCache[partialName] || await readFile(partialsDir, partialName);
        template = template.replace(fullMatch, partialContent || '');
    }

    // Step 2: Replace loops
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

    // Step 3: Replace conditionals
    const conditionalMatches = [...template.matchAll(/{{#if\s+([\w]+)}}([\s\S]*?){{\/if}}/g)];
    for (const match of conditionalMatches) {
        const [fullMatch, condition, innerTemplate] = match;
        template = template.replace(fullMatch, context[condition] ? innerTemplate : '');
    }

    // Step 4: Replace variables
    const variableMatches = [...template.matchAll(/{{\s*([\w]+)\s*}}/g)];
    for (const match of variableMatches) {
        const [fullMatch, key] = match;
        template = template.replace(fullMatch, context[key] || '');
    }

    return template;
}

// Function to wrap content in the base template
async function renderWithBase(templateContent, context = {}) {
    const baseTemplate = layoutCache['base'] || await readFile(layoutsDir, 'base');

    if (config.layouts.include.length > 0 && !config.layouts.include.includes('base')) {
        return templateContent;
    }
    if (config.layouts.exclude.includes('base')) {
        return templateContent;
    }

    return await renderTemplate(baseTemplate, { ...context, content: templateContent, currentYear: new Date().getFullYear() });
}

// Function to generate HTML for a single post
async function generateSingleHTML(title, content) {
    const singleTemplate = layoutCache['single'] || await readFile(layoutsDir, 'single');
    const renderedContent = await renderTemplate(singleTemplate, { title, content });
    return await renderWithBase(renderedContent, { title });
}

// Function to generate the index page
async function generateIndex(posts) {
    const listTemplate = layoutCache['list'] || await readFile(layoutsDir, 'list');
    const indexTemplate = layoutCache['index'] || await readFile(layoutsDir, 'index');
    const listHTML = await renderTemplate(listTemplate, { posts });
    const renderedContent = await renderTemplate(indexTemplate, { list: listHTML });
    return await renderWithBase(renderedContent, { title: 'Home' });
}

// Function to process all posts and generate HTML files
async function processContent() {
    const startTime = Date.now();
    const files = await fs.readdir(contentDir);
    const markdownFiles = files.filter(file => file.endsWith('.md'));

    await fs.ensureDir(outputDir);

    const posts = [];
    const postPromises = markdownFiles.map(async (file) => {
        const postFile = `${contentDir}/${file}`;
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
        } catch (err) {
            console.error(`Error processing file ${postFile}:`, err);
        }
    });

    await Promise.all(postPromises);

    const indexHTML = await generateIndex(posts);
    await fs.writeFile(`${outputDir}/index.html`, indexHTML);

    console.log(`Build completed in ${Date.now() - startTime} ms`);
}

// Main function to run the SSG
async function runSSG() {
    console.log('--- Starting Static Site Generation ---');
    await preloadTemplates();
    await processContent();
    console.log('--- Static Site Generation Complete ---');
}

runSSG();

const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');
const path = require('path');

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


// Function to preload layouts and partials based on config
async function preloadTemplates() {
    const layoutStartTime = Date.now(); // Start timer for layouts
    const layoutFiles = await fs.readdir(layoutsDir);
    const layoutPromises = layoutFiles.map(async (file) => {
        if (file.endsWith('.html')) {
            const layoutName = file.replace('.html', '');

            // Check include/exclude logic for layouts
            const shouldIncludeLayout =
                (config.layouts.include.length === 0 || config.layouts.include.includes(layoutName)) &&
                !config.layouts.exclude.includes(layoutName);

            if (shouldIncludeLayout) {
                try {
                    layoutCache[layoutName] = await fs.readFile(path.join(layoutsDir, file), 'utf-8');
                    console.log(`Preloaded layout: ${layoutName}`);
                } catch (err) {
                    console.error(`Error reading layout ${layoutName}:`, err);
                }
            } else {
                console.log(`Skipped layout: ${layoutName}`);
            }
        }
    });

    await Promise.all(layoutPromises);
    const layoutEndTime = Date.now(); // End timer for layouts
    const layoutTimeTaken = layoutEndTime - layoutStartTime;

    if (layoutTimeTaken < 1) {
        console.log(`Time taken to preload layouts: < 1 ms`);
    } else {
        console.log(`Time taken to preload layouts: ${layoutTimeTaken} ms`);
    }

    const partialStartTime = Date.now(); // Start timer for partials
    const partialFiles = await fs.readdir(partialsDir);
    const partialPromises = partialFiles.map(async (file) => {
        if (file.endsWith('.html')) {
            const partialName = file.replace('.html', '');

            // Check include/exclude logic for partials
            const shouldIncludePartial =
                (config.partials.include.length === 0 || config.partials.include.includes(partialName)) &&
                !config.partials.exclude.includes(partialName);

            if (shouldIncludePartial) {
                try {
                    partialCache[partialName] = await fs.readFile(path.join(partialsDir, file), 'utf-8');
                    console.log(`Preloaded partial: ${partialName}`);
                } catch (err) {
                    console.error(`Error reading partial ${partialName}:`, err);
                }
            } else {
                console.log(`Skipped partial: ${partialName}`);
            }
        }
    });

    await Promise.all(partialPromises);
    const partialEndTime = Date.now(); // End timer for partials
    const partialTimeTaken = partialEndTime - partialStartTime;

    if (partialTimeTaken < 1) {
        console.log(`Time taken to preload partials: < 1 ms`);
    } else {
        console.log(`Time taken to preload partials: ${partialTimeTaken} ms`);
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

    // Read all markdown files in parallel
    const fileContents = await Promise.all(markdownFiles.map(file => 
        fs.readFile(`${contentDir}/${file}`, 'utf-8')
    ));

    const postPromises = fileContents.map(async (fileContent, index) => {
        const fileName = markdownFiles[index];
        const postFile = `${contentDir}/${fileName}`;
        const postStartTime = Date.now();
        try {
            const { data, content } = matter(fileContent);
            const title = data.title || fileName.replace('.md', '');
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
   console.log(`Average Time per Post: ${(timings.reduce((a, b) => parseFloat(a) + parseFloat(b), 0) / timings.length * 1000).toFixed(2)} milliseconds`);
}


// Main function to run the SSG
async function runSSG() {
    console.log('--- Starting Static Site Generation ---');
    await preloadTemplates();
    await processContent();
}

runSSG();

const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');
const path = require('path');

const contentDir = 'content';
const PrebuildlayoutsDir = 'prebuild/layouts'; // Updated to point to prebuild/layouts
const outputDir = 'public';
const dataDir = 'prebuild/data'; // Directory for JSON data sources
const partialsDir = 'partials';

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
        const [fullMatch, key] =         match;
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

// Function to extract JSON data from layout files
async function extractJsonDataFromLayouts() {
    const layoutFiles = await fs.readdir(PrebuildlayoutsDir);
    for (const file of layoutFiles) {
        if (file.endsWith('.html')) {
            const layoutContent = await fs.readFile(`${PrebuildlayoutsDir}/${file}`, 'utf-8');
            const jsonMatch = layoutContent.match(/{{\s*\$data\s*=\s*"([^"]+)"\s*}}/);
            if (jsonMatch) {
                const jsonFileName = jsonMatch[1];
                const jsonFilePath = path.join(dataDir, jsonFileName);
                if (await fs.pathExists(jsonFilePath)) {
                    const jsonData = await fs.readJSON(jsonFilePath);
                    await generateMarkdownFromJson(jsonData, layoutContent);
                } else {
                    console.log(`JSON file not found: ${jsonFilePath}`);
                }
            }
        }
    }
}

// Function to generate Markdown files from JSON data based on layout content
async function generateMarkdownFromJson(data, layoutContent) {
    for (const item of data) {
        const frontMatter = matter.stringify('', {
            title: item.title || 'Untitled',
            date: item.date || new Date().toISOString(),
            desc: item.desc || ''
        });

        const slug = (item.title || 'post').toLowerCase().replace(/\s+/g, '-');
        const markdownFilePath = path.join(contentDir, `${slug}.md`);
        
        // Create the Markdown content using the layout
        const markdownContent = layoutContent
            .replace(/{{- \$title := \.title}}/, `{{- $title := "${item.title}"}}`)
            .replace(/{{- \$content:= \.content}}/, `{{- $content:= "${item.content || ''}"}}`)
            .replace(/{{- \$frontMatter := dict.*?}}/, frontMatter);

        await fs.writeFile(markdownFilePath, markdownContent);
        console.log(`Created Markdown: ${markdownFilePath}`);
    }
}

// Main content processing function
async function processContent() {
    await extractJsonDataFromLayouts(); // Extract JSON data from layouts
    const files = await fs.readdir(contentDir);

    // Initialize an array to hold all markdown files
    const markdownFiles = [];

    // Traverse through the content directory
    for (const file of files) {
        const fullPath = `${contentDir}/${file}`;
        const stats = await fs.stat(fullPath);

        if (stats.isDirectory()) {
            // If it's a directory, read its contents
            const nestedFiles = await fs.readdir(fullPath);
            nestedFiles.forEach(nestedFile => {
                if (nestedFile.endsWith('.md')) {
                    markdownFiles.push(`${file}/${nestedFile}`);
                }
            });
        } else if (stats.isFile() && file.endsWith('.md')) {
            // If it's a file and ends with .md, add it to the list
            markdownFiles.push(file);
        }
    }

    await fs.ensureDir(outputDir);

    const posts = [];
    const timings = [];
    const startTime = Date.now(); // Start total build time

    // Process all collected markdown files
    for (const file of markdownFiles) {
        const postStartTime = Date.now(); // Start individual post time
        const content = await fs.readFile(`${contentDir}/${file}`, 'utf-8');
        const { data, content: mdContent } = matter(content);
        const htmlContent = marked(mdContent);
        const html = await generateSingleHTML(data.title, htmlContent);

        // Ensure the output directory exists
            const slug = file.replace('.md', '');
        const outputFilePath = path.join(outputDir, `${slug}.html`);
        const outputDirPath = path.dirname(outputFilePath);
        await fs.ensureDir(outputDirPath); // Ensure the directory exists

        await fs.writeFile(outputFilePath, html);
        posts.push({ title: data.title, url: `${slug}.html` });

        const endTime = Date.now();
        const elapsed = ((endTime - postStartTime) / 1000).toFixed(4);
        console.log(`Generated: ${slug}.html in ${elapsed} seconds`);
        timings.push(elapsed);
    }
    
    const indexHTML = await generateIndex(posts);
    await fs.writeFile(`${outputDir}/index.html`, indexHTML);

    // Calculate total build time
    const totalEndTime = Date.now();
    const totalElapsed = ((totalEndTime - startTime) / 1000).toFixed(4);
    console.log('--- Build Statistics ---');
    console.log(`Total Posts Generated: ${posts.length}`);
    console.log(`Total Build Time: ${totalElapsed} seconds`);
    console.log(`Average Time per Post: ${(timings.reduce((a, b) => parseFloat(a) + parseFloat(b), 0) / timings.length * 1000).toFixed(4)} milliseconds`);
}

// Main SSG execution
async function runSSG() {
    console.log('--- Starting Static Site Generation ---');
    await preloadTemplates();
    await processContent();
}

runSSG();



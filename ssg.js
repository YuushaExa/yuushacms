const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');

const contentDir = 'content';
const layoutsDir = 'layouts';
const partialsDir = 'partials';
const outputDir = 'public';
const dataDir = 'prebuild/data'; // Directory for JSON data sources

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

// Function to convert JSON data into Markdown files
async function jsonToMarkdown() {
    console.log('--- Converting JSON to Markdown ---');
    const jsonFiles = await fs.readdir(dataDir);

    for (const file of jsonFiles) {
        if (file.endsWith('.json')) {
            const data = await fs.readJSON(`${dataDir}/${file}`);
            const fileBaseName = file.replace('.json', '');
            const markdownDir = `${contentDir}/${fileBaseName}`;
            await fs.ensureDir(markdownDir);

            if (Array.isArray(data)) {
                for (const item of data) {
                    const frontMatter = matter.stringify(item.desc || '', {
                        title: item.title || 'Untitled',
                        date: item.date || new Date().toISOString(),
                        desc: item.desc || ''
                    });
                    const slug = (item.title || 'post').toLowerCase().replace(/\s+/g, '-');
                    const markdownFilePath = `${markdownDir}/${slug}.md`;
                    await fs.writeFile(markdownFilePath, frontMatter);
                    console.log(`Created Markdown: ${markdownFilePath}`);
                }
            }
        }
    }
}

// Main content processing function
async function processContent() {
    await jsonToMarkdown(); // Convert JSON data to Markdown
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
    
    // Process all collected markdown files
    for (const file of markdownFiles) {
        const content = await fs.readFile(`${contentDir}/${file}`, 'utf-8');
        const { data, content: mdContent } = matter(content);
        const htmlContent = marked(mdContent);
        const html = await generateSingleHTML(data.title, htmlContent);
        const slug = file.replace('.md', '');
        await fs.writeFile(`${outputDir}/${slug}.html`, html);
        posts.push({ title: data.title, url: `${slug}.html` });
    }
    
    const indexHTML = await generateIndex(posts);
    await fs.writeFile(`${outputDir}/index.html`, indexHTML);
}


// Main SSG execution
async function runSSG() {
    console.log('--- Starting Static Site Generation ---');
    await preloadTemplates();
    await processContent();
}

runSSG();

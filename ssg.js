const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');

const contentDir = 'content';
const layoutsDir = 'layouts';
const partialsDir = 'partials';
const outputDir = 'public';
const jsonDataDir = 'prebuild/data';

// Configuration for layouts, partials, and JSON
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
        include: [], // Specify JSON files to include
        exclude: []   // Specify JSON files to exclude
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

// Function to read a JSON file
async function readJsonFile(fileName) {
    const filePath = `${jsonDataDir}/${fileName}`;
    if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    }
    return [];
}

// Function to preload all layouts and partials
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

    // Handle JSON data inclusion
    const jsonMatches = [...template.matchAll(/{{\s*\$data\s*=\s*([\w\.]+)\s*}}/g)];
    for (const match of jsonMatches) {
        const [fullMatch, jsonFile] = match;
        const jsonData = await readJsonFile(jsonFile);
        context['data'] = jsonData; // Add JSON data to context
        template = template.replace(fullMatch, '');
    }

    // Handle range over JSON data
    const rangeMatches = [...template.matchAll(/{{-?\s*range\s+\$data\s*}}([\s\S]*?){{-?\s*end\s*}}/g)];
    for (const match of rangeMatches) {
        const [fullMatch, innerTemplate] = match;
        const renderedItems = await Promise.all(
            context.data.map(item => renderTemplate(innerTemplate, { ...context, ...item }))
        );
        template = template.replace(fullMatch, renderedItems.join(''));
    }

    // Handle partials
    const partialMatches = [...template.matchAll(/{{>\s*([\w]+)\s*}}/g)];
    for (const match of partialMatches) {
        const [fullMatch, partialName] = match;
               const partialContent = partialCache[partialName] || await readFile(partialsDir, partialName);
        template = template.replace(fullMatch, partialContent || '');
    }

    // Handle loops
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

    // Handle conditionals
    const conditionalMatches = [...template.matchAll(/{{#if\s+([\w]+)}}([\s\S]*?){{\/if}}/g)];
    for (const match of conditionalMatches) {
        const [fullMatch, condition, innerTemplate] = match;
        template = template.replace(fullMatch, context[condition] ? innerTemplate : '');
    }

    // Handle variables
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
function jsonToMarkdown(jsonData, title) {
    let markdownContent = `# ${title}\n\n`;

    jsonData.forEach(item => {
        markdownContent += `## ${item.title}\n`;
        markdownContent += `${item.content}\n\n`;
    });

    return markdownContent;
}

async function processContent() {
    const files = await fs.readdir(contentDir);
    const markdownFiles = files.filter(file => file.endsWith('.md'));

    // Read JSON files from the prebuild/data directory
    const jsonFiles = await fs.readdir(jsonDataDir);
    const jsonDataFiles = jsonFiles.filter(file => file.endsWith('.json'));

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
            const elapsed = ((endTime - postStartTime) / 1000).toFixed(4);
            console.log(`Generated: ${postURL} in ${elapsed} seconds`);
            timings.push(elapsed);
        } catch (err) {
            console.error(`Error processing file ${postFile}:`, err);
        }
    });

    await Promise.all(postPromises);

    // Process JSON files and convert them to Markdown
    for (const jsonFile of jsonDataFiles) {
        const jsonData = await readJsonFile(jsonFile);
        const title = jsonFile.replace('.json', ''); // Use the JSON filename as the title
        const markdownContent = jsonToMarkdown(jsonData, title);
        const markdownFileName = `${title}.md`;
        await fs.writeFile(`${contentDir}/${markdownFileName}`, markdownContent);
        console.log(`Converted ${jsonFile} to ${markdownFileName}`);
    }

    const indexHTML = await generateIndex(posts);
    await fs.writeFile(`${outputDir}/index.html`, indexHTML);

    const totalEndTime = Date.now();
    const totalElapsed = ((totalEndTime - startTime) / 1000).toFixed(4);
    console.log('--- Build Statistics ---');
    console.log(`Total Posts Generated: ${posts.length}`);
    console.log(`Total Build Time: ${totalElapsed} seconds`);
    console.log(`Average Time per Post: ${(timings.reduce((a, b) => parseFloat(a) + parseFloat(b), 0) / timings.length * 1000).toFixed(4)} milliseconds`);
}

// Main function to run the SSG
async function runSSG() {
    console.log('--- Starting Static Site Generation ---');
    await preloadTemplates();
    await processContent();
}

runSSG();

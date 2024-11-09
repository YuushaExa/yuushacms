const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');

const contentDir = 'content';
const layoutsDir = 'layouts';
const partialsDir = 'partials';
const outputDir = 'public';

const layoutCache = {};
const partialCache = {};

// Configuration for layouts and partials
const config = {
    layouts: {
        include: [], // Specify layouts to include e.g., 'base', 'single', 'list'
        exclude: [] // Specify layouts to exclude
    },
    partials: {
        include: [], // Specify partials to include
        exclude: [] // Specify partials to exclude
    }
};

// Function to preload all layouts and partials
async function preloadTemplates() {
    console.log('--- Preloading Templates ---');

    // Preload layouts
    const layoutFiles = await fs.readdir(layoutsDir);
    for (const file of layoutFiles) {
        if (file.endsWith('.html')) {
            const layoutName = file.replace('.html', '');
            const content = await fs.readFile(`${layoutsDir}/${file}`, 'utf-8');
            layoutCache[layoutName] = content;
            console.log(`Preloaded layout: ${layoutName}`);
        }
    }

    // Preload partials
    const partialFiles = await fs.readdir(partialsDir);
    for (const file of partialFiles) {
        if (file.endsWith('.html')) {
            const partialName = file.replace('.html', '');
            const content = await fs.readFile(`${partialsDir}/${file}`, 'utf-8');
            partialCache[partialName] = content;
            console.log(`Preloaded partial: ${partialName}`);
        }
    }

    console.log('--- Templates Preloaded ---');
}

// Function to read a template from the preloaded cache
async function readFile(dir, name) {
    const cache = dir === layoutsDir ? layoutCache : partialCache;

    // Check if the content is already cached
    if (cache[name]) {
        console.log(`Cache hit for ${name} in ${dir}`);
        return cache[name];
    }

    console.log(`File ${name} not found in preloaded cache for ${dir}`);
    return '';
}

// Function to render a template with context and partials
async function renderTemplate(template, context = {}) {
    if (!template) return '';

    // Step 1: Replace partials asynchronously
    const partialMatches = [...template.matchAll(/{{>\s*([\w]+)\s*}}/g)];

    for (const match of partialMatches) {
        const [fullMatch, partialName] = match;

        // Check if the partial should be included based on the config
        if (config.partials.include.length > 0 && !config.partials.include.includes(partialName)) {
            continue;
        }
        if (config.partials.exclude.includes(partialName)) {
            continue;
        }

        const partialContent = await readFile(partialsDir, partialName);
        template = template.replace(fullMatch, partialContent || '');
    }

    // Step 2: Replace loops ({{#each items}}...{{/each}})
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

    // Step 3: Replace conditionals ({{#if condition}}...{{/if}})
    const conditionalMatches = [...template.matchAll(/{{#if\s+([\w]+)}}([\s\S]*?){{\/if}}/g)];
    for (const match of conditionalMatches) {
        const [fullMatch, condition, innerTemplate] = match;
        template = template.replace(fullMatch, context[condition] ? innerTemplate : '');
    }

    // Step 4: Replace variables ({{ variable }})
    const variableMatches = [...template.matchAll(/{{\s*([\w]+)\s*}}/g)];
    for (const match of variableMatches) {
        const [fullMatch, key] = match;
        template = template.replace(fullMatch, context[key] || '');
    }

    return template;
}
async function processContent() {
    const startTime = Date.now(); // Start timer
    const files = await fs.readdir(contentDir);
    const markdownFiles = files.filter(file => file.endsWith('.md'));

    await fs.ensureDir(outputDir);

    const posts = [];
    let processedCount = 0;

    // Process each markdown file and generate the corresponding HTML file
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

            const outputFile = `${outputDir}/${postURL}`;
            await fs.writeFile(outputFile, html);
            console.log(`Generated: ${outputFile}`);

            posts.push({ title, url: postURL });
            processedCount++;
        } catch (err) {
            console.error(`Error processing file ${postFile}:`, err);
        }
    });

    // Wait for all post processing to complete
    await Promise.all(postPromises);

    const indexHTML = await generateIndex(posts);
    const indexOutputFile = `${outputDir}/index.html`;
    await fs.writeFile(indexOutputFile, indexHTML);
    console.log(`Generated: ${indexOutputFile}`);

    const endTime = Date.now();
    console.log(`Build Time: ${endTime - startTime} ms`);
    return processedCount;
}

// Main function to run the SSG
async function runSSG() {
    try {
        console.log('--- Starting Static Site Generation ---');
        await preloadTemplates(); // Preload layouts and partials before processing content
        const contentCount = await processContent(); // Now processContent is defined
        console.log('--- Build Statistics ---');
        console.log(`Total Content Processed: ${contentCount} files`);
    } catch (err) {
        console.error('Error:', err);
    }
}

runSSG();

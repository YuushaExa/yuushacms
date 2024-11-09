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
        include: [], // Specify layouts to include example 'base', 'single', 'list'
        exclude: [] // Specify layouts to exclude
    },
    partials: {
        include: [], // Specify partials to include
        exclude: [] // Specify partials to exclude
    }
};

const layoutCache = {};
const partialCache = {};

// Function to read a file from a directory with caching
async function readFile(dir, name) {
    const cache = dir === layoutsDir ? layoutCache : partialCache;
    const filePath = `${dir}/${name}.html`;

    // Check if the content is already cached
    if (cache[name]) {
        console.log(`Cache hit for ${name} in ${dir}`);
        return cache[name]; // Return cached content
    }

    // Read from file system if not cached
    if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        cache[name] = content; // Cache the content
        console.log(`Read ${name} from ${dir} and cached it`);
        return content;
    }

    console.log(`File ${name} not found in ${dir}`);
    return '';
}

// Function to render a template with context and partials
async function renderTemplate(template, context = {}) {
     if (!template) return '';

    // Step 1: Replace partials asynchronously
    const partialMatches = [...template.matchAll(/{{>\s*([\w]+)\s*}}/g)];
    const processedPartials = new Set(); // Track processed partials

    for (const match of partialMatches) {
        const [fullMatch, partialName] = match;

        // Check if the partial should be included based on the config
        if (config.partials.include.length > 0 && !config.partials.include.includes(partialName)) {
            console.log(`Skipping partial: ${partialName} (not included in config)`);
            continue; // Skip this partial if it's not included
        }
        if (config.partials.exclude.includes(partialName)) {
            console.log(`Skipping partial: ${partialName} (excluded in config)`);
            continue; // Skip this partial if it's excluded
        }

        // Check if this partial has already been processed
        if (processedPartials.has(partialName)) {
            console.log(`Using cached partial: ${partialName}`);
            continue; // Skip reading if already processed
        }

        const partialContent = await readFile(partialsDir, partialName);
        template = template.replace(fullMatch, partialContent || '');
        processedPartials.add(partialName); // Mark this partial as processed
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

// Function to wrap content in base template
async function renderWithBase(templateContent, context = {}) {
    const baseTemplate = await readFile(layoutsDir, 'base');

    // Check if the base layout should be included
    if (config.layouts.include.length > 0 && !config.layouts.include.includes('base')) {
        return templateContent; // Return content without wrapping if excluded
    }
    if (config.layouts.exclude.includes('base')) {
        return templateContent; // Return content without wrapping if excluded
    }

    const currentYear = new Date().getFullYear();
    return await renderTemplate(baseTemplate, { ...context, content: templateContent, currentYear });
}

// Function to generate HTML for a single post
async function generateSingleHTML(title, content) {
    const singleTemplate = await readFile(layoutsDir, 'single');

    // Check if the single layout should be included
    if (config.layouts.include.length > 0 && !config.layouts.include.includes('single')) {
        return content; // Return content without wrapping if excluded
    }
    if (config.layouts.exclude.includes('single')) {
        return content; // Return content without wrapping if excluded
    }

    const renderedContent = await renderTemplate(singleTemplate, { title, content });
    return await renderWithBase(renderedContent, { title });
}

// Function to generate the post list
async function generatePostList(posts) {
    const listTemplate = await readFile(layoutsDir, 'list');

    // Check if the list layout should be included
    if (config.layouts.include.length > 0 && !config.layouts.include.includes('list')) {
        return ''; // Return empty if excluded
    }
    if (config.layouts.exclude.includes('list')) {
        return ''; // Return empty if excluded
    }

    return await renderTemplate(listTemplate, { posts });
}

// Function to generate the index page
async function generateIndex(posts) {
    const listHTML = await generatePostList(posts); // Use the new function
    const indexTemplate = await readFile(layoutsDir, 'index');

    // Check if the index layout should be included
    if (config.layouts.include.length > 0 && !config.layouts.include.includes('index')) {
        return ''; // Return empty if excluded
    }
    if (config.layouts.exclude.includes('index')) {
        return ''; // Return empty if excluded
    }

    const renderedContent = await renderTemplate(indexTemplate, { list: listHTML });
    return await renderWithBase(renderedContent, { title: 'Home' });
}

// Function to process all posts and generate HTML files
async function processContent() {
    const startTime = Date.now(); // Start timer
    const files = await fs.readdir(contentDir);
    const markdownFiles = files.filter(file => file.endsWith('.md'));

    await fs.ensureDir(outputDir);

    const posts = [];
    let processedCount = 0;

    // Create an array of promises for processing each markdown file
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
        const contentCount = await processContent();
        console.log('--- Build Statistics ---');
        console.log(`Total Content Processed: ${contentCount} files`);
    } catch (err) {
        console.error('Error:', err);
    }
}

// Run the static site generator
runSSG();


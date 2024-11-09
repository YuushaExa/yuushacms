const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');

const contentDir = 'content';
const layoutsDir = 'layouts';
const partialsDir = 'partials';
const outputDir = 'public';

// Function to read a file from a directory
async function readFile(dir, name) {
    const filePath = `${dir}/${name}.html`;
    if (await fs.pathExists(filePath)) {
        return await fs.readFile(filePath, 'utf-8');
    }
    return '';
}

// Function to render a template with context and partials
async function renderTemplate(template, context = {}) {
    if (!template) return '';

    // Step 1: Replace partials asynchronously
    const partialMatches = [...template.matchAll(/{{>\s*([\w]+)\s*}}/g)];
    for (const match of partialMatches) {
        const [fullMatch, partialName] = match;
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

// Function to wrap content in base template
async function renderWithBase(templateContent, context = {}) {
    const baseTemplate = await readFile(layoutsDir, 'base');
    const currentYear = new Date().getFullYear();
    return await renderTemplate(baseTemplate, { ...context, content: templateContent, currentYear });
}

// Function to generate HTML for a single post
async function generateSingleHTML(title, content) {
    const singleTemplate = await readFile(layoutsDir, 'single');
    const renderedContent = await renderTemplate(singleTemplate, { title, content });
    return await renderWithBase(renderedContent, { title });
}

// Function to generate the post list
async function generatePostList(posts) {
    const listTemplate = await readFile(layoutsDir, 'list');
    return await renderTemplate(listTemplate, { posts });
}

// Function to generate the index page
async function generateIndex(posts) {
    const listHTML = await generatePostList(posts); // Use the new function
    const indexTemplate = await readFile(layoutsDir, 'index');
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

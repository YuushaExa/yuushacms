const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');

const contentDir = 'content';
const layoutsDir = 'layouts';
const partialsDir = 'partials';
const outputDir = 'public';

const templates = {}; // Cache for templates
const partials = {};  // Cache for partials

// Function to read a file with caching
async function readFileWithCache(cache, dir, name) {
    if (!cache[name]) {
        const filePath = `${dir}/${name}.html`;
        if (await fs.pathExists(filePath)) {
            cache[name] = await fs.readFile(filePath, 'utf-8');
        }
    }
    return cache[name] || '';
}

// Function to render a template with context and partials
async function renderTemplate(template, context = {}) {
    if (!template) return '';

    // Handle async partial includes using replaceAll with async function
    template = await template.replace(/{{>\s*([\w]+)\s*}}/g, async (_, partialName) => {
        const partialContent = await readFileWithCache(partials, partialsDir, partialName);
        return partialContent;
    });

    // Handle loops: {{#each items}}...{{/each}}
    template = await template.replace(/{{#each\s+([\w]+)}}([\s\S]*?){{\/each}}/g, async (_, collection, innerTemplate) => {
        const items = context[collection];
        if (!Array.isArray(items)) return '';
        const renderedItems = await Promise.all(items.map(item => renderTemplate(innerTemplate, { ...context, ...item })));
        return renderedItems.join('');
    });

    // Handle conditionals: {{#if condition}}...{{/if}}
    template = await template.replace(/{{#if\s+([\w]+)}}([\s\S]*?){{\/if}}/g, async (_, condition, innerTemplate) => {
        return context[condition] ? innerTemplate : '';
    });

    // Handle variables: {{ variable }}
    template = await template.replace(/{{\s*([\w]+)\s*}}/g, (_, key) => {
        return context[key] || '';
    });

    return template;
}


// Function to wrap content in base template
async function renderWithBase(templateContent, context = {}) {
    const baseTemplate = await readFileWithCache(templates, layoutsDir, 'base');
    const currentYear = new Date().getFullYear();
    return await renderTemplate(baseTemplate, { ...context, content: templateContent, currentYear });
}

// Function to generate HTML for a single post
async function generateSingleHTML(title, content) {
    const singleTemplate = await readFileWithCache(templates, layoutsDir, 'single');
    const renderedContent = await renderTemplate(singleTemplate, { title, content });
    return await renderWithBase(renderedContent, { title });
}

// Function to generate the index page
async function generateIndex(posts) {
    const listTemplate = await readFileWithCache(templates, layoutsDir, 'list');
    const indexTemplate = await readFileWithCache(templates, layoutsDir, 'index');
    const listHTML = await renderTemplate(listTemplate, { posts });
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

    for (const file of markdownFiles) {
        const postFile = `${contentDir}/${file}`;
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
    }

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

runSSG();

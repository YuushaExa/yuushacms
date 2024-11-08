const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');

const contentDir = 'content';
const layoutsDir = 'layouts';
const partialsDir = 'partials';
const outputDir = 'public';

const templates = {}; // Store preloaded templates
const partials = {};  // Store preloaded partials

// Function to read a template file
async function readTemplate(templatePath) {
    return fs.readFile(templatePath, 'utf-8');
}

// Function to preload all templates
async function preloadTemplates() {
    const templateFiles = await fs.readdir(layoutsDir);
    for (const file of templateFiles) {
        const templateName = file.replace('.html', '');
        templates[templateName] = await readTemplate(`${layoutsDir}/${file}`);
    }
    console.log('Templates preloaded:', Object.keys(templates));
}

// Function to preload all partials
async function preloadPartials() {
    const partialFiles = await fs.readdir(partialsDir);
    for (const file of partialFiles) {
        const partialName = file.replace('.html', '');
        partials[partialName] = await readTemplate(`${partialsDir}/${file}`);
    }
    console.log('Partials preloaded:', Object.keys(partials));
}

// Function to render a template with context and partials
function renderTemplate(template, context = {}) {
    if (!template) return '';

    // Include partials
    template = template.replace(/{{>\s*([\w]+)\s*}}/g, (_, partialName) => {
        return partials[partialName] || '';
    });

    // Handle loops: {{#each items}}...{{/each}}
    template = template.replace(/{{#each\s+([\w]+)}}([\s\S]*?){{\/each}}/g, (_, collection, innerTemplate) => {
        const items = context[collection];
        if (!Array.isArray(items)) return '';
        return items.map(item => renderTemplate(innerTemplate, { ...context, ...item })).join('');
    });

    // Handle conditionals: {{#if condition}}...{{/if}}
    template = template.replace(/{{#if\s+([\w]+)}}([\s\S]*?){{\/if}}/g, (_, condition, innerTemplate) => {
        return context[condition] ? innerTemplate : '';
    });

    // Handle variables: {{ variable }}
    template = template.replace(/{{\s*([\w]+)\s*}}/g, (_, key) => {
        return context[key] || '';
    });

    return template;
}

// Function to wrap content in base template
function renderWithBase(templateContent, context = {}) {
    const baseTemplate = templates['base'];
    const currentYear = new Date().getFullYear(); 
    return renderTemplate(baseTemplate, { ...context, content: templateContent,currentYear });
}

// Function to generate HTML for a single post
async function generateSingleHTML(title, content) {
    const singleTemplate = templates['single'];
    const renderedContent = renderTemplate(singleTemplate, { title, content });
    return renderWithBase(renderedContent, { title });
}

// Function to generate the index page
async function generateIndex(posts) {
    const listTemplate = templates['list'];
    const indexTemplate = templates['index'];
    const listHTML = renderTemplate(listTemplate, { posts });
    const renderedContent = renderTemplate(indexTemplate, { list: listHTML });
    return renderWithBase(renderedContent, { title: 'Home' });
}

// Function to process all posts and generate HTML files
async function processContent() {
    const files = await fs.readdir(contentDir);
    const markdownFiles = files.filter(file => file.endsWith('.md'));

    await fs.ensureDir(outputDir); // Ensure output directory exists

    const posts = [];

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
    }

    const indexHTML = await generateIndex(posts);
    const indexOutputFile = `${outputDir}/index.html`;
    await fs.writeFile(indexOutputFile, indexHTML);
    console.log(`Generated: ${indexOutputFile}`);
}

// Main function to run the SSG
async function runSSG() {
    try {
        await preloadTemplates();
        await preloadPartials();
        await processContent();
    } catch (err) {
        console.error('Error:', err);
    }
}

runSSG();

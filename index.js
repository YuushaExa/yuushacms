const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');

const postsDir = 'src/posts';
const templatesDir = 'src/templates';
const partialsDir = 'src/partials';
const outputDir = 'output';

const templates = {}; // Store preloaded templates
const partials = {};  // Store preloaded partials

// Function to read a template file
async function readTemplate(templatePath) {
    return fs.readFile(templatePath, 'utf-8');
}

// Function to preload all templates
async function preloadTemplates() {
    // Read all files in the templates directory
    const templateFiles = await fs.readdir(templatesDir);
    for (const file of templateFiles) {
        const templateName = file.replace('.html', '');
        templates[templateName] = await readTemplate(`${templatesDir}/${file}`);
    }
    console.log('Templates preloaded:', Object.keys(templates));
}

// Function to preload all partials
async function preloadPartials() {
    // Read all files in the partials directory
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

// Function to generate HTML for a single post
async function generateSingleHTML(title, content) {
    const singleTemplate = templates['single'];
    return renderTemplate(singleTemplate, { title, content });
}

// Function to generate the index page
async function generateIndex(posts) {
    const listTemplate = templates['list'];
    const indexTemplate = templates['index'];
    const listHTML = renderTemplate(listTemplate, { posts });
    return renderTemplate(indexTemplate, { list: listHTML });
}

// Function to process all posts and generate HTML files
async function processPosts() {
    const files = await fs.readdir(postsDir);
    const markdownFiles = files.filter(file => file.endsWith('.md'));

    await fs.ensureDir(outputDir); // Ensure output directory exists

    const posts = [];

    // Process each Markdown file
    for (const file of markdownFiles) {
        const postFile = `${postsDir}/${file}`;
        const fileContent = await fs.readFile(postFile, 'utf-8');
        const { data, content } = matter(fileContent);
        const title = data.title || file.replace('.md', '');
        const slug = data.slug || title.replace(/\s+/g, '-').toLowerCase();
        const postURL = `${slug}.html`;
        const htmlContent = marked(content);

        // Generate HTML using preloaded templates
        const html = await generateSingleHTML(title, htmlContent);

        // Save the individual post HTML file
        const outputFile = `${outputDir}/${postURL}`;
        await fs.writeFile(outputFile, html);
        console.log(`Generated: ${outputFile}`);

        // Add post information to the posts array for the index
        posts.push({ title, url: postURL });
    }

    // Generate the index page
    const indexHTML = await generateIndex(posts);
    const indexOutputFile = `${outputDir}/index.html`;
    await fs.writeFile(indexOutputFile, indexHTML);
    console.log(`Generated: ${indexOutputFile}`);
}

// Main function to run the SSG
async function runSSG() {
    try {
        await preloadTemplates(); // Preload all templates
        await preloadPartials();  // Preload all partials
        await processPosts();     // Process posts and generate HTML
    } catch (err) {
        console.error('Error:', err);
    }
}

runSSG();

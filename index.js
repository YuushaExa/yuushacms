const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');

const postsDir = 'src/posts';
const baseTemplatePath = 'src/templates/base.html';
const headTemplatePath = 'src/templates/head.html';
const footerTemplatePath = 'src/templates/footer.html';
const navbarTemplatePath = 'src/partials/navbar.html';
const indexTemplatePath = 'src/templates/index.html';
const singleTemplatePath = 'src/templates/single.html';
const listTemplatePath = 'src/templates/list.html';
const outputDir = 'output';

// Function to read a template
async function readTemplate(templatePath) {
    return fs.readFile(templatePath, 'utf-8');
}

// Function to render a template with context and partials
async function renderTemplate(template, context = {}, partials = {}) {
    // Helper function to include partial templates
    template = template.replace(/{{>\s*([\w]+)\s*}}/g, (_, partialName) => {
        return partials[partialName] || '';
    });

    // Handle loops: {{#each items}}...{{/each}}
    template = template.replace(/{{#each\s+([\w]+)}}([\s\S]*?){{\/each}}/g, (_, collection, innerTemplate) => {
        const items = context[collection];
        if (!Array.isArray(items)) return '';
        return items.map(item => renderTemplate(innerTemplate, { ...context, ...item }, partials)).join('');
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
async function generateSingleHTML(postFile, title, content) {
    const head = await readTemplate(headTemplatePath);
    const footer = await readTemplate(footerTemplatePath);
    const navbar = await readTemplate(navbarTemplatePath);
    const singleTemplate = await readTemplate(singleTemplatePath);

    // Render the single post template with context and partials
    return renderTemplate(singleTemplate, { title, content }, {
        head,
        footer,
        navbar
    });
}

// Function to generate the index page
async function generateIndex(posts) {
    const head = await readTemplate(headTemplatePath);
    const footer = await readTemplate(footerTemplatePath);
    const navbar = await readTemplate(navbarTemplatePath);
    const indexTemplate = await readTemplate(indexTemplatePath);
    const listTemplate = await readTemplate(listTemplatePath);

    // Render the list template with posts context
    const listHTML = await renderTemplate(listTemplate, { posts });

    // Render the index template with context and partials
    return renderTemplate(indexTemplate, { list: listHTML }, {
        head,
        footer,
        navbar
    });
}

// Function to process all posts and generate HTML files
async function processPosts() {
    const files = await fs.readdir(postsDir);
    const markdownFiles = files.filter(file => file.endsWith('.md'));

    await fs.ensureDir(outputDir); // Ensure output directory exists

    const posts = [];

    for (const file of markdownFiles) {
        const postFile = `${postsDir}/${file}`;
        const fileContent = await fs.readFile(postFile, 'utf-8');
        const { data, content } = matter(fileContent);
        const title = data.title || file.replace('.md', '');
        const slug = data.slug || title.replace(/\s+/g, '-').toLowerCase();
        const postURL = `${slug}.html`;
        const html = await generateSingleHTML(postFile, title, marked(content));

        // Save the individual post HTML file
        const outputFile = `${outputDir}/${postURL}`;
        await fs.writeFile(outputFile, html);
        console.log(`Generated: ${outputFile}`);

        // Add post information to the posts array for the index
        posts.push({ title, url: postURL });
    }

    // Generate the index page after processing all posts
    const indexHTML = await generateIndex(posts);
    const indexOutputFile = `${outputDir}/index.html`;
    await fs.writeFile(indexOutputFile, indexHTML);
    console.log(`Generated: ${indexOutputFile}`);
}

// Run the SSG
processPosts().catch(err => console.error(err));

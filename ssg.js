const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');
const { createReadStream, createWriteStream } = require('fs');
const { pipeline } = require('stream');
const { promisify } = require('util');

const pipelineAsync = promisify(pipeline);

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

    // Create a map for partials
    const partialsMap = new Map();
    const partialMatches = [...template.matchAll(/{{>\s*([\w]+)\s*}}/g)];
    for (const match of partialMatches) {
        const [fullMatch, partialName] = match;
        if (!partialsMap.has(partialName)) {
            const partialContent = await readFile(partialsDir, partialName);
            partialsMap.set(partialName, partialContent || '');
        }
        template = template.replace(fullMatch, partialsMap.get(partialName));
    }

    // Replace loops, conditionals, and variables in a single pass
    const regex = /{{#each\s+([\w]+)}}([\s\S]*?){{\/each}}|{{#if\s+([\w]+)}}([\s\S]*?){{\/if}}|{{\s*([\w]+)\s*}}/g;

    const result = template.replace(regex, (match, eachCollection, innerTemplate, ifCondition, ifInnerTemplate, variable) => {
        if (eachCollection) {
            const items = context[eachCollection];
            if (Array.isArray(items)) {
                return items.map(item => renderTemplate(innerTemplate, { ...context, ...item })).join('');
            }
            return '';
        } else if (ifCondition) {
            return context[ifCondition] ? ifInnerTemplate : '';
        } else if (variable) {
            return context[variable] || '';
        }
        return match; // Fallback
    });

    return result;
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

// Function to generate the index page
async function generateIndex(posts) {
    const listTemplate = await readFile(layoutsDir, 'list');
    const indexTemplate = await readFile(layoutsDir, 'index');
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
    const postPromises = markdownFiles.map(async (file) => {
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
    });

    // Wait for all posts to be processed
    await Promise.all(postPromises);

    const indexHTML = await generateIndex(posts);
    const indexOutputFile = `${outputDir}/index.html`;
    await fs.writeFile(indexOutputFile, indexHTML);
    console.log(`Generated: ${indexOutputFile}`);

    const endTime = Date.now();
    console.log(`Build Time: ${endTime - startTime} ms`);
    return posts.length;
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


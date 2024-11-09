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
    const startTime = Date.now();
    const files = await fs.readdir(contentDir);
    const markdownFiles = files.filter(file => file.endsWith('.md'));

    await fs.ensureDir(outputDir);

    const posts = [];
    let processedCount = 0;

    for (const file of markdownFiles) {
        const postFile = `${contentDir}/${file}`;
        const outputFile = `${outputDir}/${file.replace('.md', '.html')}`;

        // Read the Markdown file as a stream
        const readStream = createReadStream(postFile, 'utf-8');
        const writeStream = createWriteStream(outputFile);

        // Read the file content
        const fileContent = await new Promise((resolve, reject) => {
            let data = '';
            readStream.on('data', chunk => data += chunk);
            readStream.on('end', () => resolve(data));
            readStream.on('error', reject);
        });

        // Process the Markdown content
        const { data, content } = matter(fileContent);
           const title = data.title || file.replace('.md', '');
        const htmlContent = marked(content);
        const html = await generateSingleHTML(title, htmlContent);

        // Write the generated HTML to the output file
        await writeStream.write(html);
        writeStream.end();

        console.log(`Generated: ${outputFile}`);
        posts.push({ title, url: outputFile });
        processedCount++;
    }

    // Generate the index page
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


const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');

const contentDir = 'content';
const PrebuildlayoutsDir = 'prebuild/layouts'; // Updated to point to prebuild/layouts
const outputDir = 'public';
const dataDir = 'prebuild/data'; // Directory for JSON data sources
const partialsDir = 'partials';
const layoutsDir = 'layouts'; 

// Configuration for layouts, partials, JSON, and CSV
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
        include: ["https://raw.githubusercontent.com/YuushaExa/v/refs/heads/main/games.json"], // Specify JSON files to include
        exclude: []   // Specify JSON files to exclude
    },
    csv: {
        include: [], // Specify CSV files to include
        exclude: []   // Specify CSV files to exclude
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

// Function to preload layouts and partials based on config
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

    context.currentYear = new Date().getFullYear();
    
    // Render partials
    const partialMatches = [...template.matchAll(/{{>\s*([\w]+)\s*}}/g)];
    for (const match of partialMatches) {
        const [fullMatch, partialName] = match;
        const partialContent = partialCache[partialName] || await readFile(partialsDir, partialName);
        if (partialContent) {
            template = template.replace(fullMatch, partialContent);
        } else {
            console.warn(`Partial not found: ${partialName}`);
        }
    }

    // Render loops
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

    // Render conditionals
    const conditionalMatches = [...template.matchAll(/{{#if\s+([\w]+)}}([\s\S]*?){{\/if}}/g)];
    for (const match of conditionalMatches) {
        const [fullMatch, condition, innerTemplate] = match;
        template = template.replace(fullMatch, context[condition] ? innerTemplate : '');
    }

    // Render variables
    const variableMatches = [...template.matchAll(/{{\s*([\w]+)\s*}}/g)];
    for (const match of variableMatches) {
        const [fullMatch, key] = match;
        template = template.replace(fullMatch, context[key] || '');
    }

    return template;
}

async function renderWithBase(templateContent, context = {}) {
    const baseTemplate = layoutCache['base'] || await readFile(layoutsDir, 'base');
    return await renderTemplate(baseTemplate, { ...context, content: templateContent });
}

async function generateSingleHTML(title, content, fileName) {
    const finalTitle = title || fileName.replace('.md', '').replace(/-/g, ' ');
    const singleTemplate = layoutCache['single'] || await readFile(layoutsDir, 'single');
    const renderedContent = await renderTemplate(singleTemplate, { title: finalTitle, content });
    return await renderWithBase(renderedContent, { title: finalTitle });
}

async function generateIndex(posts) {
    const listTemplate = layoutCache['list'] || await readFile(layoutsDir, 'list');
    const indexTemplate = layoutCache['index'] || await readFile(layoutsDir, 'index');
    const listHTML = await renderTemplate(listTemplate, { posts });
    const renderedContent = await renderTemplate(indexTemplate, { list: listHTML });
    return await renderWithBase(renderedContent, { title: 'Home' });
}

// Function to extract data from CSV files
async function extractCsvDataFromLayouts() {
    try {
        const csvFiles = config.csv.include; // Use the URLs from the config
        const csvExtractionPromises = csvFiles.map(async (url) => {
            if (url.endsWith('.csv')) {
                try {
                    const csvData = await fetchCsv(url);
                    await generateMarkdownFromCsv(csvData); // Generate Markdown directly from CSV data
                } catch (error) {
                    console.error(`Error processing CSV from URL ${url}: ${error.message}`);
                }
            }
        });

        // Wait for all CSV extractions to complete
        await Promise.all(csvExtractionPromises);
    } catch (error) {
        console.error(`Error reading CSV URLs: ${error.message}`);
    }
}

// Function to fetch CSV data from a URL
async function fetchCsv(url) {
    const response = await axios.get(url);
    const results = [];
    return new Promise((resolve, reject) => {
        const csvStream = csv();
        csvStream
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
        
        // Pipe the response data into the CSV parser
        response.data.pipe(csvStream);
    });
}

// Function to parse CSV file
async function parseCsv(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

// Function to generate Markdown files from CSV data
async function generateMarkdownFromCsv(data) {
    for (const item of data) {
        const frontMatter = matter.stringify('', {
            title: item.title || 'Untitled'
        });

        const slug = (item.title || 'post').toLowerCase().replace(/\s+/g, '-');
        const markdownFilePath = path.join(contentDir, `${slug}.md`);
        
        const markdownContent = `${frontMatter}\n\n${item.content || ''}\n\n${JSON.stringify(item, null, 2)}`;
        await fs.writeFile(markdownFilePath, markdownContent);
        console.log(`Created Markdown: ${markdownFilePath}`);
    }
}

// Function to extract JSON data from layout files
async function extractJsonDataFromLayouts() {
    try {
        const jsonFiles = config.json.include; // Use the URLs from the config
        const jsonExtractionPromises = jsonFiles.map(async (url) => {
            if (url.endsWith('.json')) {
                try {
                    const jsonData = await fetchJson(url);
                    await generateMarkdownFromJson(jsonData); // Generate Markdown directly from JSON data
                } catch (error) {
                    console.error(`Error processing JSON from URL ${url}: ${error.message}`);
                }
            }
        });

        // Wait for all JSON extractions to complete
        await Promise.all(jsonExtractionPromises);
    } catch (error) {
        console.error(`Error reading JSON URLs: ${error.message}`);
    }
}

// Function to fetch JSON data from a URL
async function fetchJson(url) {
    const response = await axios.get(url);
    return response.data; // Return the JSON data
}


// Function to generate Markdown files from JSON data
async function generateMarkdownFromJson(data) {
    for (const item of data) {
        const frontMatter = matter.stringify('', {
            title: item.title || 'Untitled'
        });

        const slug = (item.title || 'post').toLowerCase().replace(/\s+/g, '-');
        const markdownFilePath = path.join(contentDir, `${slug}.md`);
        
        const markdownContent = `${frontMatter}\n\n${item.content || ''}\n\n${JSON.stringify(item, null, 2)}`;
        await fs.writeFile(markdownFilePath, markdownContent);
        console.log(`Created Markdown: ${markdownFilePath}`);
    }
}

// Main content processing function
async function processContent() {
    await extractJsonDataFromLayouts(); // Extract JSON data from layouts
    await extractCsvDataFromLayouts(); // Extract CSV data from layouts
    const files = await fs.readdir(contentDir);

    // Initialize an array to hold all markdown files
    const markdownFiles = [];

    // Traverse through the content directory
    for (const file of files) {
        const fullPath = `${contentDir}/${file}`;
        const stats = await fs.stat(fullPath);

        if (stats.isDirectory()) {
            // If it's a directory, read its contents
            const nestedFiles = await fs.readdir(fullPath);
            nestedFiles.forEach(nestedFile => {
                if (nestedFile.endsWith('.md')) {
                    markdownFiles.push(`${file}/${nestedFile}`);
                }
            });
        } else if (stats.isFile() && file.endsWith('.md')) {
            // If it's a file and ends with .md, add it to the list
            markdownFiles.push(file);
        }
    }

    await fs.ensureDir(outputDir);

    const posts = [];
    const timings = [];
    const startTime = Date.now(); // Start total build time

    // Process all collected markdown files
    for (const file of markdownFiles) {
        const postStartTime = Date.now(); // Start individual post time
        const content = await fs.readFile(`${contentDir}/${file}`, 'utf-8');
        const { data, content: mdContent } = matter(content);
        const htmlContent = marked(mdContent);
        
        // Pass the file name to generateSingleHTML
        const html = await generateSingleHTML(data.title, htmlContent, file); 

        // Ensure the output directory exists
        const slug = file.replace('.md', '');
        const outputFilePath = path.join(outputDir, `${slug}.html`);
        const outputDirPath = path.dirname(outputFilePath);
        await fs.ensureDir(outputDirPath); // Ensure the directory exists

        await fs.writeFile(outputFilePath, html);
        
        // Use the title from front matter or fallback to slug
        const postTitle = data.title || slug.replace(/-/g, ' '); // Use slug as title if no front matter title
        posts.push({ title: postTitle, url: `${slug}.html` }); 

        const endTime = Date.now();
        const elapsed = ((endTime - postStartTime) / 1000).toFixed(4);
        console.log(`Generated: ${slug}.html in ${elapsed} seconds`);
        timings.push(elapsed);
    }

    const indexHTML = await generateIndex(posts);
    await fs.writeFile(`${outputDir}/index.html`, indexHTML);

    // Calculate total build time
    const totalEndTime = Date.now();
    const totalElapsed = ((totalEndTime - startTime) / 1000).toFixed(4);
    console.log('--- Build Statistics ---');
    console.log(`Total Posts Generated: ${posts.length}`);
    console.log(`Total Build Time: ${totalElapsed} seconds`);
    console.log(`Average Time per Post: ${(timings.reduce((a, b) => parseFloat(a) + parseFloat(b), 0) / timings.length * 1000).toFixed(4)} milliseconds`);
}

// Main SSG execution
async function runSSG() {
    console.log('--- Starting Static Site Generation ---');
    await preloadTemplates();
    await processContent();
}

// Execute the static site generator
runSSG().catch(error => {
    console.error('Error during static site generation:', error);
});

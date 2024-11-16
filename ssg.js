const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');
const path = require('path');
const { extractCsvDataFromLayouts, extractJsonDataFromLayouts } = require('./dataExtractor');

const contentDir = 'content';
const PrebuildlayoutsDir = 'prebuild/layouts';
const outputDir = 'public';
const partialsDir = 'partials';
const layoutsDir = 'layouts';

const config = {
    layouts: { include: [], exclude: [] },
    partials: { include: [], exclude: [] },
    json: { include: [], exclude: [] },
    csv: { include: ["https://github.com/YuushaExa/v/releases/download/csvv2/wiki_movie_plots_deduped.csv"], exclude: [] },
    pagination: { postsPerPage: 10 }
};

const layoutCache = {};
const partialCache = {};

async function readFile(dir, name) {
    const cache = dir === layoutsDir ? layoutCache : partialCache;
    const filePath = path.join(dir, `${name}.html`);

    if (cache[name]) return cache[name];

    if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        cache[name] = content;
        return content;
    }

    return '';
}

async function preloadTemplates() {
    const layoutFiles = await fs.readdir(layoutsDir);
    await Promise.all(layoutFiles.map(async (file) => {
        if (file.endsWith('.html')) {
            const layoutName = file.replace('.html', '');
            if ((config.layouts.include.length === 0 || config.layouts.include.includes(layoutName)) &&
                !config.layouts.exclude.includes(layoutName)) {
                layoutCache[layoutName] = await fs.readFile(path.join(layoutsDir, file), 'utf-8');
                console.log(`Preloaded layout: ${layoutName}`);
            } else {
                console.log(`Skipped layout: ${layoutName}`);
            }
        }
    }));

    const partialFiles = await fs.readdir(partialsDir);
    await Promise.all(partialFiles.map(async (file) => {
        if (file.endsWith('.html')) {
            const partialName = file.replace('.html', '');
            if ((config.partials.include.length === 0 || config.partials.include.includes(partialName)) &&
                !config.partials.exclude.includes(partialName)) {
                partialCache[partialName] = await fs.readFile(path.join(partialsDir, file), 'utf-8');
                console.log(`Preloaded partial: ${partialName}`);
            } else {
                console.log(`Skipped partial: ${partialName}`);
            }
        }
    }));
}

async function renderTemplate(template, context = {}) {
    if (!template) return '';

    context.currentYear = new Date().getFullYear();

    // Render partials
    template = await renderPartials(template, context);

    // Render loops
    template = await renderLoops(template, context);

    // Render conditionals
    template = await renderConditionals(template, context);

    // Render variables
    template = await renderVariables(template, context);

    return template;
}

async function renderPartials(template, context) {
    return template.replace(/{{>\s*([\w]+)\s*}}/g, (match, partialName) => {
        const partialContent = partialCache[partialName] || '';
        return partialContent || console.warn(`Partial not found: ${partialName}`) || '';
    });
}

async function renderLoops(template, context) {
    return template.replace(/{{#each\s+([\w]+)}}([\s\S]*?){{\/each}}/g, (match, collection, innerTemplate) => {
        const items = context[collection];
        if (Array.isArray(items)) {
            return items.map(item => renderTemplate(innerTemplate, { ...context, ...item })).join('');
        }
        return '';
    });
}

async function renderConditionals(template, context) {
        return template.replace(/{{#if\s+([\w]+)}}([\s\S]*?){{\/if}}/g, (match, condition, innerTemplate) => {
        return context[condition] ? innerTemplate : '';
    });
}

async function renderVariables(template, context) {
    return template.replace(/{{\s*([\w]+)\s*}}/g, (match, key) => {
        return context[key] || '';
    });
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

async function generateIndex(posts, pageNumber = 1) {
    const postsPerPage = config.pagination.postsPerPage;
    const totalPages = Math.ceil(posts.length / postsPerPage);
    const pagePosts = posts.slice((pageNumber - 1) * postsPerPage, pageNumber * postsPerPage);

    const listTemplate = layoutCache['list'] || await readFile(layoutsDir, 'list');
    const indexTemplate = layoutCache['index'] || await readFile(layoutsDir, 'index');

    const listHTML = await renderTemplate(listTemplate, { posts: pagePosts });
    const prevPage = pageNumber > 1 ? `/yuushacms/index-${pageNumber - 1}.html` : null;
    const nextPage = pageNumber < totalPages ? `/yuushacms/index-${pageNumber + 1}.html` : null;

    const renderedContent = await renderTemplate(indexTemplate, { 
        list: listHTML, 
        currentPage: pageNumber,
        totalPages: totalPages,
        prevPage: prevPage,
        nextPage: nextPage
    });

    return await renderWithBase(renderedContent, { title: 'Home' });
}

async function processContent() {
    await extractJsonDataFromLayouts(config);
    await extractCsvDataFromLayouts(config);
    
    const files = await fs.readdir(contentDir);
    const markdownFiles = files.filter(file => file.endsWith('.md')).map(file => path.join(contentDir, file));

    await fs.ensureDir(outputDir);

    const posts = [];
    const skippedEntries = [];
    const startTime = Date.now();

    for (const file of markdownFiles) {
        const content = await fs.readFile(file, 'utf-8');
        const { data, content: mdContent } = matter(content);
        const htmlContent = marked(mdContent);

        if (!data.title) {
            skippedEntries.push({ title: path.basename(file, '.md'), link: `${path.basename(file, '.md')}.html` });
            continue;
        }

        const html = await generateSingleHTML(data.title, htmlContent, path.basename(file));
        const slug = path.basename(file, '.md');
        const outputFilePath = path.join(outputDir, `${slug}.html`);
        await fs.ensureDir(path.dirname(outputFilePath));
        await fs.writeFile(outputFilePath, html);

        const postTitle = data.title || slug.replace(/-/g, ' ');
        posts.push({ title: postTitle, url: `${slug}.html` });
    }

    const totalPages = Math.ceil(posts.length / config.pagination.postsPerPage);
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
        const indexHTML = await generateIndex(posts, pageNumber);
        const pageFileName = pageNumber === 1 ? 'index.html' : `index-${pageNumber}.html`;
        await fs.writeFile(path.join(outputDir, pageFileName), indexHTML);
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(4);
    console.log('--- Build Statistics ---');
    console.log(`Total Entries Processed: ${markdownFiles.length}`);
    console.log(`Total Posts Created: ${posts.length}`);
    console.log(`Total Pages Created: ${totalPages}`);
    
    if (skippedEntries.length > 0) {
        console.log(`Skipped Entries:`);
        skippedEntries.forEach(entry => {
            console.log(`- Title: ${entry.title}, Link: ${entry.link}`);
        });
    } else {
                console.log(`No entries were skipped.`);
    }

    console.log(`Total Time for Build: ${totalElapsed} seconds`);
}

// Main SSG execution
async function runSSG() {
    console.log('--- Starting Static Site Generation ---');
    try {
        await preloadTemplates();
        await processContent();
    } catch (error) {
        console.error('Error during static site generation:', error);
    }
}

// Execute the static site generator
runSSG();

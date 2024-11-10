const fs = require('fs-extra');
const marked = require('marked');
const matter = require('gray-matter');

const contentDir = 'content';
const layoutsDir = 'prebuild/layouts';
const partialsDir = 'partials';
const dataDir = 'prebuild/data';
const outputDir = 'public';

const config = {
    layouts: {
        include: [],
        exclude: []
    },
    partials: {
        include: [],
        exclude: []
    }
};

const layoutCache = {};
const partialCache = {};

// Utility function to read files with caching
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

// Preload layouts and partials based on config
async function preloadTemplates() {
    const layoutFiles = await fs.readdir(layoutsDir);
    for (const file of layoutFiles) {
        if (file.endsWith('.html')) {
            const layoutName = file.replace('.html', '');

            const shouldIncludeLayout =
                (config.layouts.include.length === 0 || config.layouts.include.includes(layoutName)) &&
                !config.layouts.exclude.includes(layoutName);

            if (shouldIncludeLayout) {
                layoutCache[layoutName] = await fs.readFile(`${layoutsDir}/${file}`, 'utf-8');
                console.log(`Preloaded layout: ${layoutName}`);
            }
        }
    }
}

// Function to render templates with context and partials
async function renderTemplate(template, context = {}) {
    if (!template) return '';

    const partialMatches = [...template.matchAll(/{{>\s*([\w]+)\s*}}/g)];
    for (const match of partialMatches) {
        const [fullMatch, partialName] = match;
        const partialContent = partialCache[partialName] || await readFile(partialsDir, partialName);
        template = template.replace(fullMatch, partialContent || '');
    }

    const variableMatches = [...template.matchAll(/{{\s*([\w]+)\s*}}/g)];
    for (const match of variableMatches) {
        const [fullMatch, key] = match;
        template = template.replace(fullMatch, context[key] || '');
    }

    return template;
}

// Function to extract JSON data and convert to Markdown files
async function jsonToMarkdown() {
    const layoutFiles = await fs.readdir(layoutsDir);

    for (const layoutFile of layoutFiles) {
        if (layoutFile.endsWith('.html')) {
            const layoutContent = await fs.readFile(`${layoutsDir}/${layoutFile}`, 'utf-8');

            // Extract data source (JSON file)
            const dataMatch = layoutContent.match(/\{\{\s*\$data\s*=\s*"([\w\-\.]+)"\s*\}\}/);
            if (!dataMatch) continue;

            const jsonDataFile = dataMatch[1];
            const jsonDataPath = `${dataDir}/${jsonDataFile}`;
            if (!await fs.pathExists(jsonDataPath)) {
                console.error(`Data source not found: ${jsonDataPath}`);
                continue;
            }

            const jsonData = await fs.readJson(jsonDataPath);

            // Extract front matter fields
            const frontMatterMatch = layoutContent.match(/\{\{-\s*\$frontMatter\s*:=\s*dict([\s\S]*?)\}\}/);
            if (!frontMatterMatch) continue;

            const frontMatterFields = frontMatterMatch[1].trim();
            const frontMatterKeys = {};

            frontMatterFields.split('\n').forEach(line => {
                const match = line.match(/([\w]+):\s*"([\w]+)"/);
                if (match) {
                    const [_, key, value] = match;
                    frontMatterKeys[key] = value;
                }
            });

            const outputDir = `content/${layoutFile.replace('.html', '')}`;
            await fs.ensureDir(outputDir);

            for (const item of jsonData) {
                const frontMatter = {};
                for (const [key, jsonKey] of Object.entries(frontMatterKeys)) {
                    frontMatter[key] = item[jsonKey] || '';
                }

                const slug = frontMatter.title.toLowerCase().replace(/\s+/g, '-');
                const mdFilePath = `${outputDir}/${slug}.md`;

                const markdownContent = matter.stringify('', frontMatter);
                await fs.writeFile(mdFilePath, markdownContent);
                console.log(`Created Markdown: ${mdFilePath}`);
            }
        }
    }
}

// Read markdown files and generate HTML
async function generateHTML() {
    const files = await fs.readdir(contentDir);
    const markdownFiles = files.flatMap(file => file.endsWith('.md') ? [`${contentDir}/${file}`] : []);

    await fs.ensureDir(outputDir);

    const posts = [];
    const startTime = Date.now();

    for (const filePath of markdownFiles) {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        const { data, content } = matter(fileContent);

        const htmlContent = marked(content);
        const title = data.title || 'Untitled';
        const slug = title.toLowerCase().replace(/\s+/g, '-');
        const htmlFilePath = `${outputDir}/${slug}.html`;

        const singleTemplate = await readFile(layoutsDir, 'single');
        const renderedHTML = await renderTemplate(singleTemplate, { title, content: htmlContent });

        await fs.writeFile(htmlFilePath, renderedHTML);
        console.log(`Generated HTML: ${htmlFilePath}`);

        posts.push({ title, url: `${slug}.html` });
    }

    const totalEndTime = Date.now();
    const totalElapsed = ((totalEndTime - startTime) / 1000).toFixed(2);
    console.log(`--- Build Complete ---`);
    console.log(`Total Posts: ${posts.length}`);
    console.log(`Total Build Time: ${totalElapsed} seconds`);
}

// Main function to run SSG
async function runSSG() {
    console.log('--- Starting Static Site Generation ---');
    await preloadTemplates();
    await jsonToMarkdown();
    await generateHTML();
}

runSSG();

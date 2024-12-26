const fs = require('fs-extra');
const path = require('path');
const matter = require('gray-matter');
const csv = require('csv-parser');
const axios = require('axios');

const dataDir = 'prebuild/data';
const contentDir = 'content';

async function extractDataFromSources() {
    try {
        await fs.ensureDir(contentDir);
        const dataFiles = await fs.readdir(dataDir);

        for (const dataFile of dataFiles) {
            if (dataFile.endsWith('.html')) {
                const dataFilePath = path.join(dataDir, dataFile);
                const dataFileContent = await fs.readFile(dataFilePath, 'utf-8');
                const { data: frontMatter, content: htmlContent } = matter(dataFileContent);

                const dataSource = frontMatter.data;
                const mappings = { ...frontMatter };
                delete mappings.data;

                if (dataSource) {
                    let rawData;
                    if (dataSource.startsWith('http://') || dataSource.startsWith('https://')) {
                        // Handle remote URL
                        rawData = await fetchDataFromUrl(dataSource);
                    } else {
                        // Handle local file
                        const dataSourcePath = path.join(dataDir, dataSource);
                        const dataSourceType = path.extname(dataSource).toLowerCase();

                        if (dataSourceType === '.json') {
                            rawData = await fs.readJson(dataSourcePath);
                        } else if (dataSourceType === '.csv') {
                            rawData = await readCsv(dataSourcePath);
                        } else {
                            console.warn(`Unsupported data source type: ${dataSourceType}`);
                            continue;
                        }
                    }

                    const extractedData = extractDataFromHtmlContent(htmlContent);
                    Object.assign(mappings, extractedData);

                    await generateMarkdownFromData(rawData, mappings, dataSource);
                }
            }
        }
    } catch (error) {
        console.error(`Error during data extraction: ${error.message}`);
    }
}

// Function to extract key-value pairs from HTML content
function extractDataFromHtmlContent(htmlContent) {
    const data = {};
    const lines = htmlContent.split('\n');

    for (const line of lines) {
        if (line.trim() === '---') continue;
        const [key, value] = line.split('=').map(s => s.trim());
        if (key && value) {
            data[key] = value;
        }
    }

    return data;
}

async function fetchDataFromUrl(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const contentType = response.headers['content-type'];

    if (contentType.includes('application/json')) {
      return JSON.parse(response.data.toString('utf8'));
    } else if (contentType.includes('text/csv')) {
      return await readCsvFromBuffer(response.data);
    } else {
      console.warn(`Unsupported content type for URL ${url}: ${contentType}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching data from URL ${url}: ${error.message}`);
    throw error;
  }
}

function getDataSourceTypeFromUrl(url) {
  const parsedUrl = new URL(url);
  const pathname = parsedUrl.pathname;
  return path.extname(pathname).toLowerCase();
}

async function readCsvFromBuffer(buffer) {
    return new Promise((resolve, reject) => {
        const results = [];
        const text = buffer.toString('utf8'); // Convert buffer to string
        const stream = require('stream');
        const readableStream = new stream.Readable();
        readableStream.push(text);
        readableStream.push(null); // Signal end of data

        readableStream
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

async function readCsv(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

function applyMappings(item, mappings) {
    const mappedItem = {};
    for (const [templateVar, dataPath] of Object.entries(mappings)) {
        if (dataPath.startsWith('.')) {
            // Handle JSON path
            mappedItem[templateVar] = getJsonValue(item, dataPath);
        } else {
            // Handle direct values or other mappings
            mappedItem[templateVar] = dataPath;
        }
    }
    return mappedItem;
}

function getJsonValue(item, path) {
    const pathParts = path.substring(1).split('.');
    let value = item;
    for (const part of pathParts) {
        if (value[part] !== undefined) {
            value = value[part];
        } else {
            return undefined;
        }
    }
    return value;
}

async function generateMarkdownFromData(data, mappings, dataSourceName) {
    const existingSlugs = new Set();

    for (const item of data) {
        const mappedItem = applyMappings(item, mappings);
        const title = mappedItem.title || 'Untitled';
        const slug = ensureUniqueSlug(sanitizeSlug(title), existingSlugs);
        const frontMatter = matter.stringify('', { title });

        let markdownContent = `${frontMatter}\n\n`;

        // Add mapped data as variables in Markdown
        for (const [key, value] of Object.entries(mappedItem)) {
            if (typeof value === 'string') {
                markdownContent += `{{ ${key} }} = "${value}"\n`;
            } else {
                markdownContent += `{{ ${key} }} = ${JSON.stringify(value)}\n`;
            }
        }
        // Check if there's content from HTML
        const plotContent = mappings['plot'];
        if (plotContent) {
          markdownContent += `\n${plotContent}\n`;
        }

        markdownContent += `\n\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\``;

        const markdownFilePath = path.join(contentDir, `${slug}.md`);
        try {
            await fs.writeFile(markdownFilePath, markdownContent);
        } catch (error) {
            console.error(`Error creating Markdown file: ${markdownFilePath}, Error: ${error.message}`);
        }
    }
}

// Utility function to sanitize slugs (keep this as it is)
function sanitizeSlug(input, maxLength = 50, separator = '-') {
    if (!input) {
        return 'post';
    }
    let slug = input.toLowerCase().trim();
    slug = slug.replace(/[^a-z0-9\s-]/g, '');
    slug = slug.replace(/[\s-]+/g, separator);
    slug = slug.substring(0, maxLength);
    slug = slug.replace(new RegExp(`^${separator}|${separator}$`, 'g'), '');

    return slug || 'post';
}

// Function to ensure unique slugs (keep this as it is)
function ensureUniqueSlug(slug, existingSlugs) {
    let finalSlug = slug;
    let slugCounter = 1;
    while (existingSlugs.has(finalSlug)) {
        finalSlug = `${slug}-${slugCounter}`;
        slugCounter++;
    }
    existingSlugs.add(finalSlug);
    return finalSlug;
}

module.exports = {
    extractDataFromSources,
};

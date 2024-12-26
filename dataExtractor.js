const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');
const csv = require('csv-parser');
const matter = require('gray-matter');

// Directory configuration
const contentDir = 'content';

// Utility function to sanitize slugs
function sanitizeSlug(input, maxLength = 50, separator = '-') {
    if (!input) {
        return ''; // Handle empty input
    }
    let slug = input.toLowerCase().trim();
    slug = slug.replace(/[^a-z0-9\s-]/g, '');
    slug = slug.replace(/[\s-]+/g, separator);
    slug = slug.substring(0, maxLength);
    slug = slug.replace(new RegExp(`^${separator}|${separator}$`, 'g'), '');

    return slug;
}

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

// Function to extract CSV data from layouts
async function extractCsvDataFromLayouts(config) {
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
    const response = await axios.get(url, { responseType: 'stream' });
    const results = [];

    return new Promise((resolve, reject) => {
        const csvStream = response.data.pipe(csv());

        csvStream
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

// Function to generate Markdown files from CSV data
async function generateMarkdownFromCsv(data) {
  const existingSlugs = new Set();

  for (const item of data) {
    const title = item.Title || 'Untitled';
    const slug = ensureUniqueSlug(sanitizeSlug(title), existingSlugs);
    const frontMatter = matter.stringify('', { title });
    const markdownContent = `${frontMatter}\n\n${item.content || ''}\n\n\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\``;
    const markdownFilePath = path.join(contentDir, `${slug}.md`);

    try {
      await fs.writeFile(markdownFilePath, markdownContent);
      console.log(`Created: ${markdownFilePath}`);
    } catch (error) {
      console.error(`Error creating Markdown file: ${markdownFilePath}, Error: ${error.message}`);
    }
  }
}

// Function to extract JSON data from layout files
async function extractJsonDataFromLayouts(config) {
    try {
        const jsonFiles = config.json.include;
        const jsonExtractionPromises = jsonFiles.map(async (url) => {
            if (url.endsWith('.json')) {
                try {
                    const jsonData = await fetchJson(url);
                    await generateMarkdownFromJson(jsonData);
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
    return response.data;
}

// Function to generate Markdown files from JSON data
async function generateMarkdownFromJson(data) {
  const existingSlugs = new Set();

  for (const item of data) {
    const title = item.titles ? item.titles[0] : (item.title || 'Untitled');
    const slug = ensureUniqueSlug(sanitizeSlug(title), existingSlugs);
    const frontMatter = matter.stringify('', { title });
    const markdownContent = `${frontMatter}\n\n${item.content || ''}\n\n\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\``;
    const markdownFilePath = path.join(contentDir, `${slug}.md`);

    try {
      await fs.writeFile(markdownFilePath, markdownContent);
      console.log(`Created: ${markdownFilePath}`);
    } catch (error) {
      console.error(`Error creating Markdown file: ${markdownFilePath}, Error: ${error.message}`);
    }
  }
}

// Export the functions for use in other files
module.exports = {
    extractCsvDataFromLayouts,
    extractJsonDataFromLayouts,
};

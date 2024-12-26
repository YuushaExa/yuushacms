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
    return 'post'; // Handle empty input with a default
  }
  let slug = input.toLowerCase().trim();
  slug = slug.replace(/[^a-z0-9\s-]/g, '');
  slug = slug.replace(/[\s-]+/g, separator);
  slug = slug.substring(0, maxLength);
  slug = slug.replace(new RegExp(`^${separator}|${separator}$`, 'g'), '');

  return slug || 'post'; // Ensure a slug is always returned, default to 'post' if empty after sanitization
}

// Function to extract and process data from CSV and JSON URLs
async function extractDataFromSources(config) {
  try {
    // Ensure the content directory exists
    await fs.ensureDir(contentDir);

    const csvPromises = (config.csv.include || []).map(url => processDataSource(url, 'csv'));
    const jsonPromises = (config.json.include || []).map(url => processDataSource(url, 'json'));

    await Promise.all([...csvPromises, ...jsonPromises]);
  } catch (error) {
    console.error(`Error during data extraction: ${error.message}`);
  }
}

// Function to process data source based on type
async function processDataSource(url, type) {
  try {
    if (type === 'csv') {
      const csvData = await fetchCsv(url);
      await generateMarkdownFromCsv(csvData);
    } else if (type === 'json') {
      const jsonData = await fetchJson(url);
      await generateMarkdownFromJson(jsonData);
    }
  } catch (error) {
    console.error(`Error processing ${type} from URL ${url}: ${error.message}`);
  }
}

// Function to fetch CSV data from a URL
async function fetchCsv(url) {
  try {
    const response = await axios.get(url, { responseType: 'stream' });
    const results = [];

    return new Promise((resolve, reject) => {
      response.data
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', (error) => reject(error));
    });
  } catch (error) {
    throw new Error(`Failed to fetch CSV from ${url}: ${error.message}`);
  }
}

// Function to generate Markdown files from CSV data
async function generateMarkdownFromCsv(data) {
  const existingSlugs = new Set();

  for (const item of data) {
    const title = item.Title || 'Untitled';
    const slug = ensureUniqueSlug(sanitizeSlug(title), existingSlugs);

    // Construct front matter with specific fields
    const frontMatterData = {
      title: title,
      release_year: item['Release Year'], // Notice corrected keys
      origin_ethnicity: item['Origin/Ethnicity'],
      director: item.Director,
      cast: item.Cast,
      genre: item.Genre,
      wiki_page: item['Wiki Page'],
      plot: item.Plot,
    };

    // Use matter.stringify to create front matter
    const frontMatter = matter.stringify('', frontMatterData);

    // Construct markdown content, only including the plot
    const markdownContent = `${frontMatter}\n\n${item.Plot || ''}`;

    const markdownFilePath = path.join(contentDir, `${slug}.md`);

    try {
      await fs.writeFile(markdownFilePath, markdownContent);
    } catch (error) {
      console.error(`Error creating Markdown file: ${markdownFilePath}, Error: ${error.message}`);
    }
  }
}


// Function to fetch JSON data from a URL
async function fetchJson(url) {
  try {
    const response = await axios.get(url);
    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch JSON from ${url}: ${error.message}`);
  }
}

// Function to generate Markdown files from JSON data
async function generateMarkdownFromJson(data) {
  const existingSlugs = new Set();

  for (const item of data) {
    const title = item.title || (item.titles && item.titles.length > 0 ? item.titles[0] : 'Untitled'); // Corrected title extraction
    const slug = ensureUniqueSlug(sanitizeSlug(title), existingSlugs);

    // Construct front matter with the title (no other fields are available in your example JSON)
    const frontMatterData = {
      title: title,
    };

    // Use matter.stringify to create front matter
    const frontMatter = matter.stringify('', frontMatterData);

    // Construct markdown content, including only the provided content and the JSON data
    const markdownContent = `${frontMatter}\n\n${item.content || ''}\n\n\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\``;

    const markdownFilePath = path.join(contentDir, `${slug}.md`);

    try {
      await fs.writeFile(markdownFilePath, markdownContent);
    } catch (error) {
      console.error(`Error creating Markdown file: ${markdownFilePath}, Error: ${error.message}`);
    }
  }
}

// Function to ensure unique slugs
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

// Export the main function for use in other files
module.exports = {
  extractDataFromSources,
};

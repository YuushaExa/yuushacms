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
const outputDir = 'output';

// Function to read a template
async function readTemplate(templatePath) {
    return fs.readFile(templatePath, 'utf-8');
}

// Function to generate HTML from Markdown
async function generateSingleHTML(postFile, title, content) {
    const head = await readTemplate(headTemplatePath);
    const footer = await readTemplate(footerTemplatePath);
    const navbar = await readTemplate(navbarTemplatePath);
    const singleTemplate = await readTemplate(singleTemplatePath);

    // Replace placeholders in the single post template
    return singleTemplate
        .replace('{{title}}', title)
        .replace('{{content}}', content)
        .replace('{{> head }}', head)
        .replace('{{> footer }}', footer)
        .replace('{{> navbar }}', navbar);
}

// Function to generate the index page
async function generateIndex(posts) {
    const head = await readTemplate(headTemplatePath);
    const footer = await readTemplate(footerTemplatePath);
    const navbar = await readTemplate(navbarTemplatePath);
    const indexTemplate = await readTemplate(indexTemplatePath);
    const listTemplate = await readTemplate('src/templates/list.html'); // Read the list template

    // Create the list HTML by generating the list items
    const listItems = posts.map(post => {
        return `<li><a href="${post.url}">${post.title}</a></li>`;
    }).join('');

    // Replace the {{#each posts}} and {{/each}} in the list template
    const populatedListTemplate = listTemplate
        .replace('{{#each posts}}', '') // Remove the opening tag
        .replace('{{/each}}', listItems); // Replace the closing tag with the list items

    // Replace placeholders in the index template
    const indexHTML = indexTemplate
        .replace('{{> head }}', head)
        .replace('{{> footer }}', footer)
        .replace('{{> navbar }}', navbar)
        .replace('{{> list }}', populatedListTemplate); // Insert the populated list

    return indexHTML;
}




// Function to process all posts
async function processPosts() {
    const files = await fs.readdir(postsDir);
    const markdownFiles = files.filter(file => file.endsWith('.md'));

    await fs.ensureDir(outputDir); // Ensure output directory exists

    const posts = [];

    for (const file of markdownFiles) {
        const postFile = `${postsDir}/${file}`; // Constructing path manually
        const fileContent = await fs.readFile(postFile, 'utf-8');
        const { data, content } = matter(fileContent); // Parse front matter and content
        const title = data.title || file.replace('.md', ''); // Use title from front matter or fallback to filename
        const slug = data.slug || title.replace(/\s+/g, '-').toLowerCase(); // Use slug from front matter or generate one
        const postURL = `${slug}.html`; // URL for the post
        const html = await generateSingleHTML(postFile, title, marked(content));
       
        // Save the individual post HTML file
        const outputFile = `${outputDir}/${postURL}`; // Constructing path manually
        await fs.writeFile(outputFile, html);
        console.log(`Generated: ${outputFile}`);

        // Add post information to the posts array for the index
        posts.push({ title, url: postURL });
    }

    // Generate the index page after processing all posts
    const indexHTML = await generateIndex(posts);
    const indexOutputFile = `${outputDir}/index.html`; // Constructing path manually
    await fs.writeFile(indexOutputFile, indexHTML);
    console.log(`Generated: ${indexOutputFile}`);
}

// Run the SSG
processPosts().catch(err => console.error(err));

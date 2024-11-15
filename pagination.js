// pagination.js

const fs = require('fs-extra');
const path = require('path');
const { renderTemplate, generateIndex, generateSingleHTML } = require('./ssg.js'); // Ensure paths are correct

/**
 * Generates paginated index pages for your blog or posts.
 * 
 * @param {Array} posts - List of posts to paginate.
 * @param {Number} postsPerPage - How many posts should appear per page.
 * @param {String} outputDir - Output directory for paginated pages.
 */
async function generatePagination(posts, postsPerPage, outputDir) {
    const totalPosts = posts.length;
    const totalPages = Math.ceil(totalPosts / postsPerPage);

    console.log(`Total Pages: ${totalPages}`);

    // Generate index page
    const indexTemplate = await fs.readFile(path.join(outputDir, 'index.html'), 'utf-8');
    
    // Generate paginated pages
    for (let page = 1; page <= totalPages; page++) {
        const startIndex = (page - 1) * postsPerPage;
        const endIndex = Math.min(page * postsPerPage, totalPosts);
        const postsForPage = posts.slice(startIndex, endIndex);

        // Create a specific template for the paginated page
        const paginationIndex = await generateIndex(postsForPage);
        
        // Add pagination links (Previous and Next)
        let paginationHTML = paginationIndex;
        if (page > 1) {
            paginationHTML += `<a href="/page/${page - 1}.html" class="pagination-prev">Previous</a>`;
        }
        if (page < totalPages) {
            paginationHTML += `<a href="/page/${page + 1}.html" class="pagination-next">Next</a>`;
        }

        // Render the final HTML for this page
        const slug = `page/${page}`;
        const outputFilePath = path.join(outputDir, `${slug}.html`);
        await fs.ensureDir(path.dirname(outputFilePath)); // Ensure directory exists

        // Render with index template
        const finalContent = await renderTemplate(indexTemplate, { content: paginationHTML, title: `Page ${page}` });

        await fs.writeFile(outputFilePath, finalContent);
        console.log(`Generated Page ${page}: ${outputFilePath}`);
    }
}

/**
 * Adds pagination to the static site generation process.
 * 
 * @param {Array} posts - The list of posts to paginate.
 * @param {Number} postsPerPage - The number of posts per page.
 * @param {String} outputDir - The output directory where paginated pages will be saved.
 */
async function paginateSite(posts, postsPerPage, outputDir) {
    await generatePagination(posts, postsPerPage, outputDir);
}

module.exports = paginateSite;

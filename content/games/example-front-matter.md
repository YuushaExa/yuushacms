---
title: "My First Blog"
date: 2023-10-01
author: "John Doe"
tags: ["markdown", "front matter", "example"]
summary: "An example of a Markdown file with front matter."
---

# My First Blog Post

Welcome to my blog! This is my first post where I will discuss the use of front matter in Markdown files.

## What is Front Matter?

Front matter is a way to include metadata in your Markdown files. It is typically placed at the top of the file and is enclosed by triple dashes (`---`). This metadata can include information like the title, date, author, tags, and more.

## Why Use Front Matter?

Using front matter allows static site generators to process your Markdown files more effectively, enabling features like sorting, filtering, and displaying metadata on your site.

Thank you for reading!

<h1>{{ page.title }}</h1>
<p>By {{ page.author }} on {{ page.date | date: "%B %d, %Y" }}</p>
<div>
  {{ content }}
</div>

create  mapping on single page
{{ currentYear }}

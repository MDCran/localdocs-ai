# Retrieval design notes

## Search methods

Semantic search helps when a question uses different words from a document. Keyword search helps with names, acronyms, and exact identifiers. Reciprocal rank fusion combines their rankings without requiring scores on the same scale.

## Context

Atlas retrieves up to 6 passages by default. Long documents are split into chunks of 1200 characters with 180 characters of overlap. Page boundaries are preserved for PDFs.

## Evidence

A ranking score is not a probability that an answer is correct. Every citation must refer to a passage actually included in the generation context. The system should abstain when that context lacks evidence.

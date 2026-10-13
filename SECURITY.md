# Security policy

LocalDocs AI is a single-user local application. The default Docker ports bind to loopback. No authentication is implemented, so keep the API, database, and Redis private to the local machine. Do not expose the stack to a shared network or the public internet.

Uploads use generated identifiers. File types, size, extracted text, PDF page count, and DOCX archive expansion are bounded. PDF and DOCX extraction runs in a separate process with a timeout and a container memory limit. Retrieved passages are treated as untrusted data. The language model has no tools or permission to execute document content. Citation IDs are checked against passages included in the prompt.

The project does not claim protection against a compromised host, malicious local process, model defect, or vulnerable parser. Report a vulnerability privately to the repository owner before opening a public issue.

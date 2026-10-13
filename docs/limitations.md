# Operational boundaries

This repository is a local single user application. It does not implement authentication, tenancy, cloud model APIs, public hosting, OCR, document collaboration, or legal records retention controls. These are outside the current threat model.

The interface targets a personal workspace, not a high volume service. CPU inference may be slow. Model quality depends on hardware and quantization. Approximate search, simple chunk boundaries, approximate context sizing, PDF extraction order, and lexical answer checks all have limits described in the architecture and evaluation guides.

The project does not publish benchmark results, uptime claims, or model quality guarantees. An evaluation report records its timestamp, models, configuration, evidence, and measured outcomes.

Passages whose filenames or text explicitly label them as untrusted or adversarial are excluded from ordinary factual answer context. Users can still ask to inspect those passages. This marker based check does not detect every prompt injection, so document content and model output still require review for sensitive decisions.

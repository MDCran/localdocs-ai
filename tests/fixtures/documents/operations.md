# Atlas operations handbook

## Archive retention

The Atlas archive retention period is 30 days. Archived records are permanently removed after 30 days. Legal holds pause removal until the hold is released.

## Backup schedule

Incremental backups run every 6 hours. Full backups run every Sunday. Backup copies are retained for 14 days in a separate local storage pool.

## Encryption

Documents are encrypted at rest by the host filesystem. Encryption keys rotate every 90 days. Recovery keys are stored offline by the operations owner.

## Support

The operations owner reviews failed jobs every morning. A failed ingestion can be retried after the local embedding service has recovered.

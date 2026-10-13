# Atlas release checklist

## Deployment

Atlas uses blue-green deployment. The new release is observed for 30 minutes before traffic is switched. The previous deployment is retained for 7 days so that rollback remains available.

## Approval

The engineering lead approves releases after the integration suite passes. A release with a failing database migration must be stopped before any traffic switch.

## Retention comparison

Deployment artifacts are retained for 7 days. This differs from archive records, which the operations handbook retains for 30 days.

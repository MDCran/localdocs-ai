import asyncio
import logging

from localdocs.config import get_settings
from localdocs.jobs import claim_job, process_job
from localdocs.logging import configure_logging
from redis.asyncio import Redis


async def run() -> None:
    configure_logging()
    logger = logging.getLogger("localdocs.worker")
    while True:
        try:
            claimed = await claim_job()
            if claimed:
                logger.info("job_claimed", extra={"job_id": claimed[0]})
                await process_job(*claimed)
                logger.info("job_finished", extra={"job_id": claimed[0]})
                continue
            try:
                async with Redis.from_url(get_settings().redis_url) as redis:
                    await redis.blpop("localdocs:wake", timeout=3)
            except Exception:
                await asyncio.sleep(3)
        except Exception:
            logger.error("worker_cycle_failed")
            await asyncio.sleep(3)


if __name__ == "__main__":
    asyncio.run(run())

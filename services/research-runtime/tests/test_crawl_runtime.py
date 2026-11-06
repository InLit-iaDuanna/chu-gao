"""Crawl wrapper boundaries; no external network or model calls."""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import capture_failure, install_public_routes, public_url


class CrawlRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_dns_is_bounded_and_invalid_ports_are_rejected(self):
        with patch("app.asyncio.wait_for", AsyncMock(side_effect=asyncio.TimeoutError)) as wait, patch("app.asyncio.to_thread", Mock(return_value=None)):
            self.assertFalse(await public_url("https://example.com"))
            self.assertEqual(wait.call_args.kwargs["timeout"], 5)
        self.assertFalse(await public_url("https://example.com:not-a-port"))

    async def test_subresources_share_dns_but_credentials_never_reuse_approval(self):
        page = SimpleNamespace(is_closed=Mock(return_value=False))
        context = SimpleNamespace(route=AsyncMock())
        with patch("app.public_url", AsyncMock(return_value=True)) as check:
            await install_public_routes(page, context)
            handler = context.route.call_args.args[1]
            routes = []
            for url in ("https://example.com/a", "https://example.com/b", "https://user:pass@example.com/private"):
                route = SimpleNamespace(request=SimpleNamespace(url=url), continue_=AsyncMock(), abort=AsyncMock())
                routes.append(route)
                await handler(route)
            self.assertEqual(check.await_count, 1)
            routes[0].continue_.assert_awaited_once()
            routes[1].continue_.assert_awaited_once()
            routes[2].abort.assert_awaited_once()

    async def test_closed_page_does_not_continue_pending_route(self):
        page = SimpleNamespace(is_closed=Mock(side_effect=[False, True]))
        context = SimpleNamespace(route=AsyncMock())
        route = SimpleNamespace(request=SimpleNamespace(url="https://example.com/a"), continue_=AsyncMock(), abort=AsyncMock())
        with patch("app.public_url", AsyncMock(return_value=True)):
            await install_public_routes(page, context)
            await context.route.call_args.args[1](route)
        route.continue_.assert_not_awaited()
        route.abort.assert_not_awaited()

    async def test_close_race_is_ignored_but_live_page_errors_are_not(self):
        from playwright.async_api import Error
        for closed in (True, False):
            page = SimpleNamespace(is_closed=Mock(side_effect=[False, False, closed]))
            context = SimpleNamespace(route=AsyncMock())
            route = SimpleNamespace(request=SimpleNamespace(url="https://example.com/a"), continue_=AsyncMock(side_effect=Error("Synthetic route failure")), abort=AsyncMock())
            with patch("app.public_url", AsyncMock(return_value=True)):
                await install_public_routes(page, context)
                handler = context.route.call_args.args[1]
                if closed:
                    await handler(route)
                else:
                    with self.assertRaises(Error):
                        await handler(route)

    async def test_failure_codes_keep_root_status_and_retryability(self):
        for status, code, retryable in ((403, "CRAWL_BLOCKED", False), (404, "CRAWL_NOT_FOUND", False), (429, "CRAWL_RATE_LIMITED", True), (503, "CRAWL_HTTP_ERROR", True)):
            failure = capture_failure("Synthetic status", status)
            self.assertEqual(failure.detail, {"code": code, "message": failure.detail["message"], "httpStatus": status, "retryable": retryable})
        self.assertEqual(capture_failure("Page.goto: Timeout 60000ms exceeded").detail["code"], "CRAWL_TIMEOUT")
        self.assertEqual(capture_failure("net::ERR_NAME_NOT_RESOLVED").detail["code"], "CRAWL_DNS_FAILED")


if __name__ == "__main__":
    unittest.main()

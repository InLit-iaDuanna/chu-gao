"""Real local extractors and mocked transports; no model or external calls."""
import io
import socket
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from capture_pipeline import PublicResolver, SourceFailure, capture_page, fetch_document

HTML = """<!doctype html><html><head><title>Appliance comparison fixture</title></head>
<body><nav>Navigation noise</nav><article><h1>Countertop appliances</h1>
<p>A synthetic public report compares countertop equipment for office lunches. The first product supports mixing and heating in one vessel, while the second requires transferring ingredients. Cleaning time, shared storage and electricity are recorded separately.</p>
<p>Participants prepared several different recipes and documented each step. This sample does not claim measured market size, willingness to pay or health benefits. The source records only the known observations from the controlled comparison.</p>
<table><tr><th>Product</th><th>Power</th></tr><tr><td>Fixture A</td><td>1200 W</td></tr></table>
</article><footer>Footer navigation</footer></body></html>"""


def document(data=HTML.encode(), **kwargs):
    return {"url": "https://example.com/source", "data": data, "pdf": False, "contentType": "text/html", "charset": "utf-8", "httpStatus": 200, **kwargs}


def pdf_bytes(with_text=True):
    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    if with_text:
        font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(b"BT /F1 12 Tf 72 720 Td (Known PDF source. Fixture appliance rated power 1200 W.) Tj ET")
        page[NameObject("/Contents")] = writer._add_object(stream)
    writer.add_metadata({"/Title": "Fixture PDF report"})
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


class FakeResponse:
    def __init__(self, status=200, headers=None, chunks=()):
        self.status, self.headers, self.chunks = status, headers or {}, chunks
        self.charset = "utf-8"
        self.content = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def iter_chunked(self, _):
        for chunk in self.chunks:
            yield chunk


class CapturePipelineTests(unittest.IsolatedAsyncioTestCase):
    async def test_static_page_uses_real_trafilatura_without_starting_browser(self):
        browser = AsyncMock()
        with patch("capture_pipeline.fetch_document", AsyncMock(return_value=document())):
            result = await capture_page("https://example.com/source", False, browser)
        self.assertEqual(result["captureMethod"], "http-trafilatura")
        self.assertIn("1200 W", result["markdown"])
        self.assertNotIn("Navigation noise", result["markdown"])
        browser.assert_not_awaited()

    async def test_screenshot_failure_keeps_successful_body_and_records_warning(self):
        browser = AsyncMock(side_effect=SourceFailure("CRAWL_TIMEOUT", "Synthetic screenshot timeout"))
        with patch("capture_pipeline.fetch_document", AsyncMock(return_value=document())):
            result = await capture_page("https://example.com/source", True, browser)
        self.assertIn("1200 W", result["markdown"])
        self.assertEqual(result["screenshotStatus"], "failed")
        self.assertEqual(result["captureWarnings"][0]["code"], "CRAWL_TIMEOUT")

    async def test_successful_screenshot_does_not_replace_http_body_with_browser_noise(self):
        browser = AsyncMock(return_value={"screenshot": "fixture-png", "markdown": "unrelated browser text"})
        with patch("capture_pipeline.fetch_document", AsyncMock(return_value=document())):
            result = await capture_page("https://example.com/source", True, browser)
        self.assertIn("1200 W", result["markdown"])
        self.assertNotIn("unrelated", result["markdown"])
        self.assertEqual(result["screenshot"], "fixture-png")

    async def test_screenshot_timeout_and_challenge_keep_body_but_not_invalid_image(self):
        for browser in (AsyncMock(side_effect=TimeoutError("Synthetic timeout")), AsyncMock(return_value={"html": "<html><title>Just a moment...</title></html>", "screenshot": "invalid-challenge-image"})):
            with patch("capture_pipeline.fetch_document", AsyncMock(return_value=document())):
                result = await capture_page("https://example.com/source", True, browser)
            self.assertEqual(result["screenshotStatus"], "failed")
            self.assertIsNone(result["screenshot"])
            self.assertIn("1200 W", result["markdown"])

    async def test_javascript_shell_falls_back_to_rendered_html_extraction(self):
        browser = AsyncMock(return_value={"url": "https://example.com/source", "html": HTML, "markdown": "", "screenshot": None})
        with patch("capture_pipeline.fetch_document", AsyncMock(return_value=document(b"<html><body><div id='app'></div></body></html>"))):
            result = await capture_page("https://example.com/source", False, browser)
        self.assertEqual(result["captureMethod"], "browser-trafilatura")
        self.assertIn("1200 W", result["markdown"])
        browser.assert_awaited_once_with("https://example.com/source", False)

    async def test_pdf_content_type_routes_to_real_pypdf_even_without_pdf_extension(self):
        browser = AsyncMock()
        with patch("capture_pipeline.fetch_document", AsyncMock(return_value=document(pdf_bytes(), pdf=True, contentType="application/pdf"))):
            result = await capture_page("https://example.com/download?id=1", True, browser)
        self.assertEqual(result["captureMethod"], "http-pypdf")
        self.assertIn("1200 W", result["markdown"])
        self.assertEqual(result["document"]["pages"], 1)
        self.assertEqual(result["screenshotStatus"], "not_applicable")
        browser.assert_not_awaited()

    async def test_image_only_pdf_is_not_claimed_as_read(self):
        browser = AsyncMock()
        with patch("capture_pipeline.fetch_document", AsyncMock(return_value=document(pdf_bytes(False), pdf=True, contentType="application/pdf"))):
            with self.assertRaises(SourceFailure) as failure:
                await capture_page("https://example.com/source.pdf", False, browser)
        self.assertEqual(failure.exception.detail["code"], "CRAWL_PDF_NO_TEXT")
        browser.assert_not_awaited()

    async def test_detected_pdf_parse_timeout_never_uses_browser(self):
        browser = AsyncMock()
        with patch("capture_pipeline.fetch_document", AsyncMock(return_value=document(b"%PDF-fixture", pdf=True, contentType="application/pdf"))), patch("capture_pipeline.extract_pdf", side_effect=TimeoutError("Synthetic parse timeout")):
            with self.assertRaises(SourceFailure):
                await capture_page("https://example.com/download", False, browser)
        browser.assert_not_awaited()

    async def test_challenge_and_forbidden_pages_are_not_saved_as_body(self):
        browser = AsyncMock()
        with patch("capture_pipeline.fetch_document", AsyncMock(return_value=document(b'<html><head><base href="https://www.google.com/recaptcha/challengepage/"></head><body>challenge</body></html>'))):
            with self.assertRaises(SourceFailure) as failure:
                await capture_page("https://example.com/source", False, browser)
        self.assertEqual(failure.exception.detail["code"], "CRAWL_CHALLENGE")
        with patch("capture_pipeline.fetch_document", AsyncMock(side_effect=SourceFailure("CRAWL_BLOCKED", "HTTP 403", 403))):
            with self.assertRaises(SourceFailure):
                await capture_page("https://example.com/source", False, browser)
        browser.assert_not_awaited()

    async def test_redirect_to_private_address_is_stopped_before_second_request(self):
        calls = []
        class Client:
            async def __aenter__(self):
                return self
            async def __aexit__(self, *_):
                return False
            def get(self, url, **kwargs):
                calls.append(url)
                return FakeResponse(302, {"Location": "http://127.0.0.1/secret"})
        with patch("capture_pipeline.aiohttp.ClientSession", return_value=Client()):
            with self.assertRaises(SourceFailure) as failure:
                await fetch_document("https://example.com/start")
        self.assertEqual(failure.exception.detail["code"], "CRAWL_INVALID_URL")
        self.assertEqual(calls, ["https://example.com/start"])

    async def test_resolver_rejects_private_dns_and_returns_exact_checked_public_ip(self):
        loop = __import__("asyncio").get_running_loop()
        for address in ("127.0.0.1", "93.184.216.34"):
            with patch.object(loop, "getaddrinfo", AsyncMock(return_value=[(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (address, 443))])):
                if address.startswith("127"):
                    with self.assertRaises(SourceFailure):
                        await PublicResolver().resolve("example.com", 443)
                else:
                    result = await PublicResolver().resolve("example.com", 443)
                    self.assertEqual(result[0]["host"], address)


if __name__ == "__main__":
    unittest.main()

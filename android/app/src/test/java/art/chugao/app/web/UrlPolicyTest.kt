package art.chugao.app.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 导航规则的同源判断，必须挡住所有形似域名与越权 scheme。 */
class UrlPolicyTest {

    @Test
    fun sameOrigin_acceptsAppHost() {
        assertTrue(UrlPolicy.isSameOrigin("https://chugao.art"))
        assertTrue(UrlPolicy.isSameOrigin("https://chugao.art/"))
        assertTrue(UrlPolicy.isSameOrigin("https://chugao.art/works?x=1#frag"))
        assertTrue(UrlPolicy.isSameOrigin("https://chugao.art:443/path"))
        assertTrue(UrlPolicy.isSameOrigin("   https://chugao.art/x   "))
    }

    @Test
    fun sameOrigin_ignoresSchemeAndHostCase() {
        assertTrue(UrlPolicy.isSameOrigin("HTTPS://CHUGAO.ART/x"))
        assertTrue(UrlPolicy.isSameOrigin("https://Chugao.Art/X"))
        assertTrue(UrlPolicy.isSameOrigin("hTTpS://cHuGaO.aRt:443/x"))
    }

    @Test
    fun sameOrigin_rejectsLookalikeHosts() {
        val urls = listOf(
            "https://chugao.art.evil.com/",
            "https://evil.com/?chugao.art",
            "https://evil.com/#chugao.art",
            "https://evil.com/chugao.art",
            "https://chugao.art@evil.com/",
            "https://chugao.art@evil.com:443/",
            "https://user:pass@evil.com/chugao.art",
            "https://evil.com\\@chugao.art/",
            "https://chugao-art.com/",
            "https://chugao.art.co/",
            "https://chugao.art./",
            "https://sub.chugao.art/",
            "https://notchugao.art/",
            "http://chugao.art/",
        )
        for (url in urls) {
            assertFalse("must not be same origin: $url", UrlPolicy.isSameOrigin(url))
        }
    }

    @Test
    fun sameOrigin_rejectsNonDefaultPortAndRelativeUrl() {
        assertFalse(UrlPolicy.isSameOrigin("https://chugao.art:8443/"))
        assertFalse(UrlPolicy.isSameOrigin("https://chugao.art:80/"))
        assertFalse(UrlPolicy.isSameOrigin("/__local/files/a.png"))
        assertFalse(UrlPolicy.isSameOrigin("chugao.art/x"))
        assertFalse(UrlPolicy.isSameOrigin(""))
        assertFalse(UrlPolicy.isSameOrigin(null))
    }

    @Test
    fun decide_routesInAppPages() {
        assertEquals(UrlDecision.InApp, UrlPolicy.decide("https://chugao.art/"))
        assertEquals(UrlDecision.InApp, UrlPolicy.decide("https://chugao.art:443/chat?id=1"))
    }

    @Test
    fun decide_routesOtherHttpsToCustomTabs() {
        assertEquals(
            UrlDecision.ExternalBrowser("https://example.com/a?b=1"),
            UrlPolicy.decide("https://example.com/a?b=1"),
        )
        assertEquals(
            UrlDecision.ExternalBrowser("https://chugao.art:8443/admin"),
            UrlPolicy.decide("https://chugao.art:8443/admin"),
        )
        assertEquals(
            UrlDecision.ExternalBrowser("https://chugao.art.evil.com/"),
            UrlPolicy.decide("https://chugao.art.evil.com/"),
        )
    }

    @Test
    fun decide_allowsAboutBlank() {
        assertEquals(UrlDecision.AllowAboutBlank, UrlPolicy.decide("about:blank"))
        assertEquals(UrlDecision.AllowAboutBlank, UrlPolicy.decide("ABOUT:BLANK"))
        assertEquals(UrlDecision.Blocked, UrlPolicy.decide("about:srcdoc"))
        assertEquals(UrlDecision.Blocked, UrlPolicy.decide("about:config"))
    }

    @Test
    fun decide_allowsWhitelistedAppSchemes() {
        val schemes = listOf("weixin", "alipays", "alipay", "mqqapi", "upwrp")
        for (scheme in schemes) {
            val url = "$scheme://pay.example/path?a=1"
            val decision = UrlPolicy.decide(url)
            assertTrue("$scheme should be ExternalApp but was $decision", decision is UrlDecision.ExternalApp)
            assertEquals(scheme, (decision as UrlDecision.ExternalApp).scheme)
            assertEquals(url, decision.url)
        }
    }

    @Test
    fun decide_routesIntentScheme() {
        val url = "intent://pay#Intent;scheme=alipays;package=com.eg.android.AlipayGphone;end"
        assertEquals(UrlDecision.AppIntent(url), UrlPolicy.decide(url))
    }

    @Test
    fun decide_blocksDangerousSchemes() {
        val urls = listOf(
            "http://chugao.art/",
            "http://example.com/",
            "file:///etc/passwd",
            "content://media/external/images/1",
            "javascript:alert(document.cookie)",
            "data:text/html,<script>alert(1)</script>",
            "blob:https://chugao.art/1234",
            "tel:+8613800000000",
            "mailto:a@b.com",
            "ftp://example.com/x",
            "chrome://settings",
        )
        for (url in urls) {
            assertEquals("must be blocked: $url", UrlDecision.Blocked, UrlPolicy.decide(url))
        }
    }

    @Test
    fun decide_blocksEmptyAndRelative() {
        assertEquals(UrlDecision.Blocked, UrlPolicy.decide(null))
        assertEquals(UrlDecision.Blocked, UrlPolicy.decide(""))
        assertEquals(UrlDecision.Blocked, UrlPolicy.decide("   "))
        assertEquals(UrlDecision.Blocked, UrlPolicy.decide("/relative/path"))
        assertEquals(UrlDecision.Blocked, UrlPolicy.decide("//chugao.art/x"))
        assertEquals(UrlDecision.Blocked, UrlPolicy.decide("https://"))
    }

    @Test
    fun isHttpsUrl_requiresHost() {
        assertTrue(UrlPolicy.isHttpsUrl("https://example.com/x"))
        assertTrue(UrlPolicy.isHttpsUrl("https://chugao.art/x"))
        assertFalse(UrlPolicy.isHttpsUrl("http://example.com/x"))
        assertFalse(UrlPolicy.isHttpsUrl("https://"))
        assertFalse(UrlPolicy.isHttpsUrl("javascript:1"))
        assertFalse(UrlPolicy.isHttpsUrl(null))
    }

    @Test
    fun hostPortOf_parsesUserInfoAndPort() {
        val plain = UrlPolicy.hostPortOf("https://chugao.art/x")
        assertEquals("chugao.art", plain?.host)
        assertEquals(-1, plain?.port)

        val withPort = UrlPolicy.hostPortOf("https://chugao.art:8443/x")
        assertEquals("chugao.art", withPort?.host)
        assertEquals(8443, withPort?.port)

        val userInfo = UrlPolicy.hostPortOf("https://chugao.art@evil.com/x")
        assertEquals("evil.com", userInfo?.host)

        val ipv6 = UrlPolicy.hostPortOf("https://[::1]:8443/x")
        assertEquals("[::1]", ipv6?.host)
        assertEquals(8443, ipv6?.port)
    }
}

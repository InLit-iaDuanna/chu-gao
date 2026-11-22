package art.chugao.app.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** localStore 的 key 规则与路径穿越防护。 */
class LocalStoreKeyTest {

    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun acceptsWellFormedKeys() {
        val valid = listOf(
            "a",
            "A9",
            "image.png",
            "snapshot_2024-01-01.v2",
            "a..b",
            "x".repeat(LocalStoreKeys.MAX_LENGTH),
        )
        for (key in valid) {
            assertTrue("should be valid: $key", LocalStoreKeys.isValid(key))
            assertEquals(key, LocalStoreKeys.normalize(key))
        }
    }

    @Test
    fun rejectsLeadingDotAndTraversalKeys() {
        val invalid = listOf(
            ".hidden",
            "..",
            ".",
            "../evil",
            "../../etc/passwd",
            "./evil",
            "a/../../b",
            "a/b",
            "a\\b",
            "..\\evil",
        )
        for (key in invalid) {
            assertFalse("should be invalid: $key", LocalStoreKeys.isValid(key))
            assertNull(LocalStoreKeys.normalize(key))
        }
    }

    @Test
    fun rejectsBadCharactersAndEmptyKeys() {
        val invalid = listOf(
            "",
            " ",
            "a b",
            "a:b",
            "a*b",
            "中文",
            "%2e%2e%2f",
            "a\u0000b",
            "x".repeat(LocalStoreKeys.MAX_LENGTH + 1),
        )
        for (key in invalid) {
            assertFalse("should be invalid: $key", LocalStoreKeys.isValid(key))
        }
        assertFalse(LocalStoreKeys.isValid(null))
    }

    @Test
    fun resolve_keepsFilePathInsideBaseDir() {
        val base = temporaryFolder.newFolder("local-files")
        val resolved = LocalStoreKeys.resolve(base, "image.png")
        assertNotNull(resolved)
        assertEquals(File(base, "image.png").canonicalPath, resolved!!.canonicalPath)
    }

    @Test
    fun resolve_allowsDotsInsideFileName() {
        val base = temporaryFolder.newFolder("local-files")
        val resolved = LocalStoreKeys.resolve(base, "a..b")
        assertNotNull(resolved)
        assertTrue(resolved!!.canonicalPath.startsWith(base.canonicalPath + File.separator))
    }

    @Test
    fun resolve_rejectsTraversal() {
        val base = temporaryFolder.newFolder("local-files")
        val attempts = listOf(
            "../evil.png",
            "../../evil.png",
            "./evil.png",
            "..",
            "a/../../evil.png",
            "subdir/evil.png",
        )
        for (key in attempts) {
            assertNull("should reject: $key", LocalStoreKeys.resolve(base, key))
        }
    }

    @Test
    fun resolve_rejectsNullOrOversizedKeys() {
        val base = temporaryFolder.newFolder("local-files")
        assertNull(LocalStoreKeys.resolve(base, null))
        assertNull(LocalStoreKeys.resolve(base, ""))
        assertNull(LocalStoreKeys.resolve(base, "x".repeat(500)))
    }
}

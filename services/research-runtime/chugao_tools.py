import os
import httpx
from langchain_core.tools import tool
from proposal_export import ProposalDocument, export_proposal


async def call(name, payload):
    async with httpx.AsyncClient(timeout=100, trust_env=False) as client:
        response = await client.post(os.environ["CHUGAO_GATEWAY_URL"] + "/" + name, headers={"Authorization": "Bearer " + os.environ["CHUGAO_GATEWAY_TOKEN"]}, json=payload)
        response.raise_for_status()
        return response.json()


@tool
async def chugao_search(query: str) -> dict:
    """Search for one specific evidence gap within the Chugao task budget."""
    return await call("search", {"query": query})


@tool
async def chugao_read_page(url: str) -> dict:
    """Capture a public source and return its stable evidence ID and original text."""
    page = await call("crawl", {"url": url, "screenshot": True})
    return {key: page.get(key) for key in ("url", "title", "markdown", "evidenceId")}


@tool
def chugao_create_proposal(proposal: ProposalDocument) -> dict:
    """Export a versioned proposal as native PPTX, DOCX and script-free HTML.

    Use contract_version=2 and the exact finalResearchPackage.version. Supply one
    semantic slides tree: layout overview/evidence (claims), comparison/tradeoffs
    (table), or process (steps). The same content renders into all formats. Each
    factual claim or table row needs status and evidence_ids for original text; hypotheses require
    assumption_basis and retained hypothesis_id (claim) / hypothesis_ids (row/step).
    Claim text AND assumption_basis must exactly match that hypothesis's text AND basis.
    Copy both fields verbatim from the frozen package; do not summarize its basis.
    Numeric recommendations require source
    or retained hypothesis support. User requirements match confirmedRequirements.
    verified additionally needs a verifiedClaims entry from the research package.
    Extracted provided attachments are labelled user material without hyperlinks;
    search snippets and image placeholders cannot support observations.
    Set status=draft unless research quality is supported. Do not supply legacy
    points/sections with v2. Global caveats are preserved in every format. If text
    fails fit validation, shorten or split it without dropping facts or caveats.
    Paths, formats and source ownership are server-controlled. Do not run code,
    scan fonts, download assets, or claim completion until this tool succeeds.
    """
    return export_proposal(ProposalDocument.model_validate(proposal))

"""一份虚构的完整档案，测试时直接放进浏览器的 localStorage。"""
import time
NOW = int(time.time() * 1000)

def profile():
    pubs = [
        {"title": "Early-cycle prediction of lithium-ion battery lifetime with graph neural networks", "year": 2024, "venue": "Nature Energy", "citations": 320},
        {"title": "BattLife: an open benchmark for battery degradation modeling", "year": 2023, "venue": "Joule", "citations": 150},
        {"title": "Transfer learning across battery chemistries", "year": 2022, "venue": "Journal of Power Sources", "citations": 61},
        {"title": "Uncertainty-aware state of health estimation", "year": 2021, "venue": "", "citations": 12},
    ]
    def cite(i, imp, cat, sel=None):
        c = {"citingTitle": f"Citing paper number {i} on fast qualification of cells", "authors": "R. Garcia, T. Nguyen", "venue": "Joule", "year": 2025,
             "citations": 10 * i, "url": f"https://doi.org/10.1000/citing{i}", "topAuthor": "", "contexts": [f"We adopt the early-cycle predictor of Doe et al. [{i}] to estimate cell lifetime."],
             "category": cat, "importance": imp, "reason": "明确说采用了该方法"}
        if sel is not None:
            c["selected"] = sel
        return c
    return {
        "firstName": "Jane", "lastName": "Doe", "chineseName": "", "field": "Battery Informatics",
        "degrees": [{"id": "d1", "type": "博士（PhD）", "major": "Materials Science", "university": "Example University", "year": "2022", "related": "yes"}],
        "enrolled": None, "scholarUrl": "", "s2Url": "", "papers": "4", "citations": "543", "hIndex": "4",
        "records": [{"source": "Semantic Scholar", "url": "https://www.semanticscholar.org/author/1", "name": "Jane Doe", "papers": "4", "citations": "543", "hIndex": "4",
                     "publications": pubs, "fetchedAt": NOW}],
        "primarySource": "Semantic Scholar",
        "analyses": [{"title": pubs[0]["title"], "year": 2024, "paperUrl": "https://www.semanticscholar.org/paper/x", "analyzedAt": NOW, "total": 320, "scanned": 320,
                      "selfCitations": 12, "withContext": 40, "analyzed": 3,
                      "items": [cite(1, "high", "uses"), cite(2, "medium", "baseline", True), cite(3, "low", "mention")]}],
        "soc": {"subareas": "Battery lifetime prediction\nData-driven materials testing", "importance": "Batteries degrade and testing them takes months. SOC-IMPORTANCE.",
                "projects": [{"id": "p1", "title": "Early-cycle lifetime prediction", "start": "08/2021", "end": "进行中", "outputs": "Nature Energy paper, 2024",
                              "funding": "", "summary": "I designed a model that predicts lifetime from the first 100 cycles. SOC-SUMMARY.", "impact": "#1 Used by Garcia et al."}],
                "awards": "Best Paper Award, ICES 2024 (3 of 1,247)", "reviews": [{"id": "r1", "venue": "Joule", "count": "4", "invited": "yes"}],
                "openSource": "BattLife (github.com/example/battlife)", "media": "", "other": ""},
        "endeavor": {"statement": "My proposed endeavor is to develop data-driven methods that predict battery lifetime in order to speed up battery development in the United States.",
                     "plan": "Project 1 (2027-2028): extend the model to commercial cells. ENDEAVOR-PLAN.", "role": "Research Scientist at Example Labs, CA.",
                     "progress": "- BattLife has 12,000 downloads.", "waiver": "The endeavor spans institutions."},
        "reviews": "1–5", "currentPosition": "Research Scientist at Example Labs, CA", "sameField": "yes", "fieldFrom": "", "fieldTo": "",
        "activeResearch": "yes", "nextPaper": "03/2027", "updatedAt": NOW,
    }

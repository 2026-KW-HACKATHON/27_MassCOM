#!/usr/bin/env python3
"""Verify that the fixed showcase page is honest and read-only."""

from html.parser import HTMLParser
from pathlib import Path
import re
import sys


def fail(reason: str) -> None:
    raise SystemExit(f"showcase site verification failed: {reason}")


class ReadOnlyPage(HTMLParser):
    tags = {
        "html", "head", "meta", "title", "link", "body", "a", "header",
        "main", "section", "h1", "h2", "p", "span", "div", "footer",
        "strong", "small", "nav", "ul", "li",
    }
    common = {"class", "id", "aria-label", "aria-labelledby", "role"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_body = False
        self.visible: list[str] = []
        self.merchants = 0
        self.main = False
        self.korean = False
        self.local_css = False
        self.csp = False

    def handle_starttag(self, tag: str, raw_attrs: list[tuple[str, str | None]]) -> None:
        if tag not in self.tags:
            fail(f"허용되지 않은 태그: {tag}")
        attrs = dict(raw_attrs)
        allowed = set(self.common)
        if tag == "html":
            allowed.add("lang")
        if tag == "meta":
            allowed = {"charset", "name", "content", "http-equiv"}
        if tag == "a":
            allowed.add("href")
        if tag == "link":
            allowed.update({"rel", "href"})
        if tag == "section":
            allowed.add("data-demo-merchant")
        if set(attrs) - allowed:
            fail(f"허용되지 않은 속성: {tag}")

        if tag == "a" and not (attrs.get("href") or "").startswith("#"):
            fail("허용되지 않은 URL")
        if tag == "link":
            if attrs.get("rel") != "stylesheet" or attrs.get("href") != "assets/showcase.css":
                fail("허용되지 않은 URL")
            self.local_css = True
        if tag == "meta":
            self._check_meta(attrs)
        if tag == "html":
            self.korean = attrs.get("lang") == "ko"
        if tag == "body":
            self.in_body = True
        if tag == "main":
            self.main = True
        if tag == "section" and "data-demo-merchant" in attrs:
            self.merchants += 1

    def _check_meta(self, attrs: dict[str, str | None]) -> None:
        if set(attrs) == {"charset"} and (attrs.get("charset") or "").lower() == "utf-8":
            return
        if (
            set(attrs) == {"name", "content"}
            and attrs.get("name") == "viewport"
            and attrs.get("content") == "width=device-width, initial-scale=1"
        ):
            return
        if (
            set(attrs) == {"name", "content"}
            and attrs.get("name") == "description"
            and (attrs.get("content") or "").strip()
        ):
            return
        if (
            set(attrs) == {"http-equiv", "content"}
            and (attrs.get("http-equiv") or "").lower() == "content-security-policy"
            and attrs.get("content")
            == "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'"
        ):
            self.csp = True
            return
        fail("허용되지 않은 meta")

    def handle_endtag(self, tag: str) -> None:
        if tag == "body":
            self.in_body = False

    def handle_data(self, data: str) -> None:
        if self.in_body:
            self.visible.append(data)


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "apps/showcase-web")
    html_file = root / "index.html"
    css_file = root / "assets/showcase.css"
    if not html_file.is_file() or not css_file.is_file():
        fail("정적 페이지 또는 CSS 없음")

    page = ReadOnlyPage()
    page.feed(html_file.read_text(encoding="utf-8"))
    if not (page.korean and page.main and page.local_css and page.csp):
        fail("한국어·본문·로컬 CSS·CSP 중 하나가 없음")
    if page.merchants != 1:
        fail("가상 점포 수가 1이 아님")

    visible = " ".join(page.visible)
    required = (
        "체험용 가상 데이터로 서비스 흐름을 보여드립니다",
        "가상 점포 · 실제 방문할 수 없습니다",
        "예시 방문 기록",
        "앱 안의 예시 수집품 · 실제 NFT가 아닙니다",
        "앱의 체험 진행 결과와 자동으로 동기화되지 않습니다",
        "실제 운영 성과가 아닙니다",
    )
    for copy in required:
        if copy not in visible:
            fail(f"필수 문구 없음: {copy}")
    if re.search(r"FINALIZED|발행 완료|0x[a-fA-F0-9]{40}", visible):
        fail("금지 문구")

    css = css_file.read_text(encoding="utf-8")
    if re.search(
        r"@import|url\s*\(|display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s*[;}])",
        css,
        re.I,
    ):
        fail("허용되지 않은 CSS")
    print("showcase site verified")


if __name__ == "__main__":
    main()

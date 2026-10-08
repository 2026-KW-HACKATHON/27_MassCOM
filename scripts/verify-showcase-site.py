#!/usr/bin/env python3
"""Verify that the fixed showcase page is honest and read-only."""

from html.parser import HTMLParser
from pathlib import Path
import json
import re
import sys


def fail(reason: str) -> None:
    raise SystemExit(f"showcase site verification failed: {reason}")


class ReadOnlyPage(HTMLParser):
    tags = {
        "html", "head", "meta", "title", "link", "body", "a", "header",
        "main", "section", "h1", "h2", "h3", "p", "span", "div", "footer",
        "strong", "small", "nav", "ul", "li", "img",
    }
    common = {"class", "id", "aria-label", "aria-labelledby", "role"}
    # 이미지는 시연 웹 폴더의 PNG만, 대체 글자와 함께 쓴다(CSP img-src 'self').
    local_image = re.compile(r"assets/[a-z0-9-]+\.png")
    csp_values = (
        "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'",
        "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'",
    )

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_body = False
        self.visible: list[str] = []
        self.merchants = 0
        self.merchant_visible: list[list[str]] = []
        self.current_merchant: list[str] | None = None
        self.main = False
        self.korean = False
        self.local_css = False
        self.csp = False
        self.csp_allows_images = False
        self.images: list[str] = []
        self.image_alts: list[str] = []

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
        if tag == "img":
            allowed.update({"src", "alt", "width", "height", "loading", "decoding"})
        if set(attrs) - allowed:
            fail(f"허용되지 않은 속성: {tag}")

        if tag == "img":
            if not self.local_image.fullmatch(attrs.get("src") or ""):
                fail("허용되지 않은 URL")
            if attrs.get("alt") is None:
                fail("이미지 대체 글자 없음")
            self.images.append(attrs["src"] or "")
            self.image_alts.append(attrs.get("alt") or "")

        if tag == "a" and not (attrs.get("href") or "").startswith("#"):
            fail("허용되지 않은 URL")
        if tag == "link":
            if attrs.get("rel") == "icon" and self.local_image.fullmatch(attrs.get("href") or ""):
                self.images.append(attrs["href"] or "")
            elif attrs.get("rel") != "stylesheet" or attrs.get("href") != "assets/showcase.css?v=20260929":
                fail("허용되지 않은 URL")
            else:
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
            self.current_merchant = []
            self.merchant_visible.append(self.current_merchant)

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
            and attrs.get("content") in self.csp_values
        ):
            self.csp = True
            self.csp_allows_images = "img-src 'self'" in (attrs.get("content") or "")
            return
        fail("허용되지 않은 meta")

    def handle_endtag(self, tag: str) -> None:
        if tag == "body":
            self.in_body = False
        if tag == "section":
            self.current_merchant = None

    def handle_data(self, data: str) -> None:
        if self.in_body:
            self.visible.append(data)
            if self.current_merchant is not None:
                self.current_merchant.append(data)


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
    stores = json.loads((Path(__file__).resolve().parent.parent / "apps/api/src/showcase/wolgye-stores.json").read_text(encoding="utf-8"))["stores"]
    if len(stores) != 30:
        fail("월계 공공데이터 점포 원본 수가 30이 아님")
    if page.merchants != len(stores):
        fail("월계 가게 수가 30이 아님")
    if any(
        "실제 가게 정보로 만든 시연 · 참여하지 않은 가게" not in " ".join(card)
        for card in page.merchant_visible
    ):
        fail("필수 문구 없음: 공공데이터 가게")
    for card, store in zip(page.merchant_visible, stores):
        if store["name"] not in " ".join(card) or store["roadAddress"] not in " ".join(card):
            fail("월계 공공데이터 점포 정보 불일치")

    visible = " ".join(page.visible)
    required = (
        "가게 정보는 공공데이터에 등록된 실제 음식점입니다",
        "방문·도장·코인·혜택은 체험용 가상 데이터",
        "실제 가게 정보로 만든 시연 · 참여하지 않은 가게",
        "예시 방문 기록",
        "앱 안의 예시 수집품 · 실제 NFT가 아닙니다",
        "앱의 체험 진행 결과와 자동으로 동기화되지 않습니다",
        "실제 운영 성과가 아닙니다",
    )
    for copy in required:
        if copy not in visible:
            fail(f"필수 문구 없음: {copy}")
    if re.search(r"FINALIZED|발행 완료|0x[a-fA-F0-9]{40}", " ".join([visible, *page.image_alts])):
        fail("금지 문구")
    if page.images and not page.csp_allows_images:
        fail("이미지에는 CSP img-src 'self'가 필요함")
    for image in page.images:
        if not (root / image).is_file():
            fail(f"이미지 파일 없음: {image}")

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

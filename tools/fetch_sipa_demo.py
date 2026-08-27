#!/usr/bin/env python3
"""Obtiene SOLO los retratos SIPA de los perfiles de prueba de Mi ASPCH.

Respeta el flujo real de SIPA y selecciona exactamente ``img.fotografia``.
No intenta saltar CAPTCHA, verificación humana ni bloqueos. Si SIPA presenta
uno de esos controles, el proceso se detiene para revisión manual.
"""
from __future__ import annotations

import argparse
import random
import re
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

SIPA_LOGIN_URL = "https://sipa.dgac.gob.cl/login"

# 7 Directorio + 4 perfiles adicionales. Eduardo Demo se excluye porque es ficticio.
DEFAULT_RUTS = [
    "15548304-0", "12404248-8", "17971385-3", "17322384-6",
    "19077844-4", "7514811-9", "17759726-0", "16662796-6",
    "5279548-6", "16098739-1", "15003994-0",
]


def blocked(text: str) -> bool:
    t = text.casefold()
    return any(k in t for k in [
        "captcha", "recaptcha", "verificación humana", "verificacion humana",
        "demasiadas solicitudes", "too many requests", "acceso bloqueado",
        "access denied", "temporarily blocked",
    ])


def open_search(page):
    page.goto(SIPA_LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except PlaywrightTimeoutError:
        pass
    page.wait_for_timeout(700)
    text = page.locator("body").inner_text()
    if blocked(text):
        raise RuntimeError("SIPA solicita verificación humana o bloqueó temporalmente el acceso.")
    link = page.locator('a[onclick*="verificarLicencia"]')
    if not link.count():
        link = page.get_by_text(re.compile(r"Verificaci[oó]n\s+de\s+Licencia", re.I), exact=False)
    if not link.count():
        raise RuntimeError('No encontré "Verificación de Licencia" en SIPA.')
    link.first.click()
    page.locator("#username").wait_for(state="visible", timeout=20000)
    page.locator("#btnBuscar").wait_for(state="visible", timeout=10000)


def fetch_one(page, rut: str, destination: Path, debug_dir: Path):
    open_search(page)
    field = page.locator("#username").first
    field.fill("")
    field.press_sequentially(rut, delay=45)
    field.evaluate("""el => {
        el.dispatchEvent(new Event('input',{bubbles:true}));
        el.dispatchEvent(new Event('change',{bubbles:true}));
        el.dispatchEvent(new Event('blur',{bubbles:true}));
    }""")
    if field.input_value().strip().upper() != rut.upper():
        raise RuntimeError("SIPA no conservó el RUT ingresado.")

    button = page.locator("#btnBuscar").first
    try:
        with page.expect_response(lambda r: "/usuarioLicencia/busqueda/" in r.url, timeout=20000):
            button.click()
    except PlaywrightTimeoutError:
        button.click()
    page.wait_for_timeout(700)

    body = page.locator("body").inner_text()
    if blocked(body):
        raise RuntimeError("SIPA solicitó verificación humana o bloqueó las consultas.")

    result = page.locator('button[onclick^="verLicencia("], button[onclick*="verLicencia("]')
    if not result.count():
        raise RuntimeError("SIPA no devolvió una licencia para este RUT o cambió su interfaz.")

    try:
        with page.expect_response(lambda r: "usuarioLicencia" in r.url or "licencia" in r.url.casefold(), timeout=15000):
            result.first.click()
    except PlaywrightTimeoutError:
        result.first.click()

    # CRÍTICO: esta es la fotografía real de SIPA, no la credencial completa.
    photo = page.locator("img.fotografia")
    photo.wait_for(state="visible", timeout=20000)
    page.wait_for_function("""() => {
        const img=document.querySelector('img.fotografia');
        return !!img && img.complete && img.naturalWidth>0 && img.naturalHeight>0;
    }""", timeout=20000)

    destination.parent.mkdir(parents=True, exist_ok=True)
    photo.screenshot(path=str(destination), type="png")
    debug_dir.mkdir(parents=True, exist_ok=True)
    src = photo.get_attribute("src") or ""
    if src:
        (debug_dir / f"{rut}_foto_src.txt").write_text(src, encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="./sipa-retratos", help="Carpeta destino")
    ap.add_argument("--debug", default="./sipa-debug", help="Carpeta de auditoría")
    ap.add_argument("--headless", action="store_true", help="Ejecutar Chromium sin ventana")
    ap.add_argument("--rut", action="append", dest="ruts", help="RUT normalizado; repetir para varios")
    args = ap.parse_args()

    out = Path(args.output)
    dbg = Path(args.debug)
    ruts = args.ruts or DEFAULT_RUTS

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless)
        context = browser.new_context(viewport={"width": 1280, "height": 900}, locale="es-CL")
        page = context.new_page()
        for i, rut in enumerate(ruts, 1):
            dest = out / f"{rut}.png"
            if dest.exists():
                print(f"[{i}/{len(ruts)}] {rut}: ya existe")
                continue
            print(f"[{i}/{len(ruts)}] SIPA {rut}…")
            try:
                fetch_one(page, rut, dest, dbg)
                print(f"    ✓ {dest}")
            except Exception as exc:
                print(f"    ⚠ {exc}")
                try:
                    page.screenshot(path=str(dbg / f"{rut}_error.png"), full_page=True)
                except Exception:
                    pass
                if "verificación humana" in str(exc).casefold() or "bloque" in str(exc).casefold():
                    print("Proceso detenido para no intentar eludir controles de SIPA.")
                    break
            time.sleep(3.5 + random.uniform(0.2, 1.0))
        context.close()
        browser.close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""DEPRECATED Streamlit UI.

This project now runs reports and scheduler operations exclusively via:
- FastAPI (`agent_api.main`)
- Portal Next.js frontend

This module is intentionally non-operational to avoid legacy execution paths.
"""

import streamlit as st

st.set_page_config(page_title="SenNet Legacy UI (Disabled)", layout="centered")
st.error("⚠️ Streamlit legacy está desactivado.")
st.info("Usa Portal Next.js + FastAPI para informes y scheduler.")
st.stop()

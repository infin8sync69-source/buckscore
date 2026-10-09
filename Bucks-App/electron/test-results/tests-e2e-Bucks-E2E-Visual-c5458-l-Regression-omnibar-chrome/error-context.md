# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/e2e.spec.js >> Bucks E2E & Visual Regression Suite >> Visual Regression: omnibar chrome
- Location: tests/e2e.spec.js:51:3

# Error details

```
Error: expect(locator).toHaveScreenshot(expected) failed

Locator: locator('#url-search-wrap')
  Expected an image 320px by 32px, received 253px by 30px. 2925 pixels (ratio 0.29 of all image pixels) are different.

  Snapshot: omnibar-chrome.png

Call log:
  - Expect "toHaveScreenshot(omnibar-chrome.png)" with timeout 5000ms
    - verifying given screenshot expectation
  - waiting for locator('#url-search-wrap')
    - locator resolved to <div id="url-search-wrap" class="glass-panel glass-panel--inset">…</div>
  - taking element screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - attempting scroll into view action
    - waiting for element to be stable
  - Expected an image 320px by 32px, received 253px by 30px. 2925 pixels (ratio 0.29 of all image pixels) are different.
  - waiting 100ms before taking screenshot
  - waiting for locator('#url-search-wrap')
    - locator resolved to <div id="url-search-wrap" class="glass-panel glass-panel--inset">…</div>
  - taking element screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - attempting scroll into view action
    - waiting for element to be stable
  - captured a stable screenshot
  - Expected an image 320px by 32px, received 253px by 30px. 2925 pixels (ratio 0.29 of all image pixels) are different.

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e15]:
    - navigation "Main toolbar" [ref=e16]:
      - toolbar [ref=e17]:
        - generic:
          - generic "Select an element in the page to inspect it" [ref=e18]:
            - button "Select an element in the page to inspect it - ⌘ ⇧ C" [ref=e19]
          - generic "Toggle device toolbar" [ref=e21]:
            - button "Toggle device toolbar - ⌘ ⇧ M" [ref=e22]
      - generic:
        - tablist "Panels"
        - button "More tabs" [ref=e25]
      - toolbar [ref=e28]:
        - generic:
          - generic "Settings" [ref=e31]:
            - button "Settings - F1 - ⇧ ?" [ref=e32]
          - button "Customize and control DevTools" [ref=e34]:
            - button "Customize and control DevTools" [ref=e35]
          - generic "Close" [ref=e37]:
            - button "Close" [ref=e38]
    - tabpanel "Elements panel" [ref=e41]:
      - generic "elements" [ref=e42]:
        - generic [ref=e44]:
          - generic [ref=e47]:
            - generic:
              - main "DOM tree explorer" [ref=e49]:
                - tree "Page DOM" [ref=e53]:
                  - treeitem "<!DOCTYPE html>" [ref=e54]:
                    - generic [ref=e57]: <!DOCTYPE html>
                  - 'treeitem "<html lang=\"en\" style=\"--agent-dock-clearance: 72px;\"> View source code" [expanded] [ref=e59]':
                    - generic [ref=e60]:
                      - 'generic "<html lang=\"en\" style=\"--agent-dock-clearance: 72px;\">" [ref=e62]':
                        - text: <
                        - generic [ref=e63]: html
                        - generic [ref=e64]:
                          - generic [ref=e65]: lang
                          - text: ="en"
                        - generic [ref=e66]:
                          - generic [ref=e67]: style
                          - text: "=\"--agent-dock-clearance: 72px;\""
                        - text: ">"
                      - generic "View source code" [ref=e70]:
                        - generic [ref=e72]: view-source
                  - group [ref=e73]:
                    - treeitem "<head> Expand …</head>" [ref=e74]:
                      - generic [ref=e76]:
                        - generic "<head>" [ref=e77]:
                          - text: <
                          - generic [ref=e78]: head
                          - text: ">"
                        - button "Expand" [ref=e80]
                        - text: …
                        - generic "</head>" [ref=e82]:
                          - text: <
                          - generic [ref=e83]: /head
                          - text: ">"
                    - treeitem "<body style=\"margin:0; padding:0; overflow:hidden;\" class=\"platform-darwin dock-collapsed\">" [expanded] [selected] [ref=e85]:
                      - generic [ref=e86]:
                        - generic "<body style=\"margin:0; padding:0; overflow:hidden;\" class=\"platform-darwin dock-collapsed\">" [ref=e88]:
                          - text: <
                          - generic [ref=e89]: body
                          - generic [ref=e90]:
                            - generic [ref=e91]: style
                            - text: ="margin:0; padding:0; overflow:hidden;"
                          - generic [ref=e92]:
                            - generic [ref=e93]: class
                            - text: ="platform-darwin dock-collapsed"
                          - text: ">"
                        - generic [ref=e97]: == $0
                    - group [ref=e98]:
                      - treeitem "<div class=\"titlebar-drag-region\"></div>" [ref=e99]:
                        - generic [ref=e101]:
                          - generic "<div class=\"titlebar-drag-region\">" [ref=e102]:
                            - text: <
                            - generic [ref=e103]: div
                            - generic [ref=e104]:
                              - generic [ref=e105]: class
                              - text: ="titlebar-drag-region"
                            - text: ">"
                          - generic "</div>" [ref=e106]:
                            - text: <
                            - generic [ref=e107]: /div
                            - text: ">"
                      - treeitem "<!-- Ambient Environmental Theme Background Glows -->" [ref=e109]:
                        - generic [ref=e112]: <!-- Ambient Environmental Theme Background Glows -->
                      - 'treeitem "<div id=\"bg-glow\" style=\"position:fixed; inset:0; z-index:0; pointer-events:none; transition: background 0.5s ease; background: radial-gradient(58% 50% at 18% 8%, var(--accent-soft), transparent 62%), radial-gradient(45% 45% at 86% 70%, var(--accent-soft), transparent 65%), linear-gradient(165deg, var(--bg-body) 0%, var(--bg-body) 100%);\"></div>" [ref=e114]':
                        - generic [ref=e116]:
                          - 'generic "<div id=\"bg-glow\" style=\"position:fixed; inset:0; z-index:0; pointer-events:none; transition: background 0.5s ease; background: radial-gradient(58% 50% at 18% 8%, var(--accent-soft), transparent 62%), radial-gradient(45% 45% at 86% 70%, var(--accent-soft), transparent 65%), linear-gradient(165deg, var(--bg-body) 0%, var(--bg-body) 100%);\">" [ref=e117]':
                            - text: <
                            - generic [ref=e118]: div
                            - generic [ref=e119]:
                              - generic [ref=e120]: id
                              - text: ="bg-glow"
                            - generic [ref=e121]:
                              - generic [ref=e122]: style
                              - text: "=\"position:fixed; inset:0; z-index:0; pointer-events:none; transition: background 0.5s ease; background: radial-gradient(58% 50% at 18% 8%, var(--accent-soft), transparent 62%), radial-gradient(45% 45% at 86% 70%, var(--accent-soft), transparent 65%), linear-gradient(165deg, var(--bg-body) 0%, var(--bg-body) 100%);\""
                            - text: ">"
                          - generic "</div>" [ref=e123]:
                            - text: <
                            - generic [ref=e124]: /div
                            - text: ">"
                      - treeitem "<div style=\"position:fixed; inset:0; z-index:0; background:radial-gradient(120% 110% at 50% 50%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.1) 100%); pointer-events:none;\"></div>" [ref=e126]:
                        - generic [ref=e128]:
                          - generic "<div style=\"position:fixed; inset:0; z-index:0; background:radial-gradient(120% 110% at 50% 50%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.1) 100%); pointer-events:none;\">" [ref=e129]:
                            - text: <
                            - generic [ref=e130]: div
                            - generic [ref=e131]:
                              - generic [ref=e132]: style
                              - text: ="position:fixed; inset:0; z-index:0; background:radial-gradient(120% 110% at 50% 50%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.1) 100%); pointer-events:none;"
                            - text: ">"
                          - generic "</div>" [ref=e133]:
                            - text: <
                            - generic [ref=e134]: /div
                            - text: ">"
                      - treeitem "<!-- ROOT APP CONTAINER -->" [ref=e136]:
                        - generic [ref=e139]: <!-- ROOT APP CONTAINER -->
                      - treeitem "<div class=\"app-container\" style=\"position:relative; z-index:1; min-height:100vh; width:100%; overflow:hidden; font-family:'Instrument Sans',system-ui,sans-serif; color:var(--text-primary);\"> Expand …</div>" [ref=e141]:
                        - generic [ref=e143]:
                          - generic "<div class=\"app-container\" style=\"position:relative; z-index:1; min-height:100vh; width:100%; overflow:hidden; font-family:'Instrument Sans',system-ui,sans-serif; color:var(--text-primary);\">" [ref=e144]:
                            - text: <
                            - generic [ref=e145]: div
                            - generic [ref=e146]:
                              - generic [ref=e147]: class
                              - text: ="app-container"
                            - generic [ref=e148]:
                              - generic [ref=e149]: style
                              - text: ="position:relative; z-index:1; min-height:100vh; width:100%; overflow:hidden; font-family:'Instrument Sans',system-ui,sans-serif; color:var(--text-primary);"
                            - text: ">"
                          - button "Expand" [ref=e151]
                          - text: …
                          - generic "</div>" [ref=e153]:
                            - text: <
                            - generic [ref=e154]: /div
                            - text: ">"
                      - treeitem "<!-- BOTTOM AGENT CHAT INTERFACE -->" [ref=e156]:
                        - generic [ref=e159]: <!-- BOTTOM AGENT CHAT INTERFACE -->
                      - treeitem "<!-- WIDGET LIBRARY OVERLAY -->" [ref=e161]:
                        - generic [ref=e164]: <!-- WIDGET LIBRARY OVERLAY -->
                      - treeitem "<div id=\"widget-library-overlay\" class=\"overlay hidden\" style=\"position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:36px; background:rgba(10,10,12,0.4); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);\"> Expand …</div>" [ref=e166]:
                        - generic [ref=e168]:
                          - generic "<div id=\"widget-library-overlay\" class=\"overlay hidden\" style=\"position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:36px; background:rgba(10,10,12,0.4); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);\">" [ref=e169]:
                            - text: <
                            - generic [ref=e170]: div
                            - generic [ref=e171]:
                              - generic [ref=e172]: id
                              - text: ="widget-library-overlay"
                            - generic [ref=e173]:
                              - generic [ref=e174]: class
                              - text: ="overlay hidden"
                            - generic [ref=e175]:
                              - generic [ref=e176]: style
                              - text: ="position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:36px; background:rgba(10,10,12,0.4); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);"
                            - text: ">"
                          - button "Expand" [ref=e178]
                          - text: …
                          - generic "</div>" [ref=e180]:
                            - text: <
                            - generic [ref=e181]: /div
                            - text: ">"
                      - treeitem "<!-- APP STORE OVERLAY -->" [ref=e183]:
                        - generic [ref=e186]: <!-- APP STORE OVERLAY -->
                      - treeitem "<div id=\"store-overlay\" class=\"overlay hidden\" style=\"position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:36px; background:rgba(10,10,12,0.42); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);\"> Expand …</div>" [ref=e188]:
                        - generic [ref=e190]:
                          - generic "<div id=\"store-overlay\" class=\"overlay hidden\" style=\"position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:36px; background:rgba(10,10,12,0.42); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);\">" [ref=e191]:
                            - text: <
                            - generic [ref=e192]: div
                            - generic [ref=e193]:
                              - generic [ref=e194]: id
                              - text: ="store-overlay"
                            - generic [ref=e195]:
                              - generic [ref=e196]: class
                              - text: ="overlay hidden"
                            - generic [ref=e197]:
                              - generic [ref=e198]: style
                              - text: ="position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:36px; background:rgba(10,10,12,0.42); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);"
                            - text: ">"
                          - button "Expand" [ref=e200]
                          - text: …
                          - generic "</div>" [ref=e202]:
                            - text: <
                            - generic [ref=e203]: /div
                            - text: ">"
                      - treeitem "<!-- CUSTOM TAB CONTEXT MENU -->" [ref=e205]:
                        - generic [ref=e208]: <!-- CUSTOM TAB CONTEXT MENU -->
                      - 'treeitem "<div id=\"tab-context-menu\" class=\"hidden\" style=\"position: fixed; z-index: 10000; width: 180px; padding: 6px; border-radius: 14px; background: rgba(30, 30, 34, 0.95); backdrop-filter: blur(30px); border: 1px solid var(--border-strong); box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4); display: flex; flex-direction: column; gap: 2px;\"> Expand …</div>" [ref=e210]':
                        - generic [ref=e212]:
                          - 'generic "<div id=\"tab-context-menu\" class=\"hidden\" style=\"position: fixed; z-index: 10000; width: 180px; padding: 6px; border-radius: 14px; background: rgba(30, 30, 34, 0.95); backdrop-filter: blur(30px); border: 1px solid var(--border-strong); box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4); display: flex; flex-direction: column; gap: 2px;\">" [ref=e213]':
                            - text: <
                            - generic [ref=e214]: div
                            - generic [ref=e215]:
                              - generic [ref=e216]: id
                              - text: ="tab-context-menu"
                            - generic [ref=e217]:
                              - generic [ref=e218]: class
                              - text: ="hidden"
                            - generic [ref=e219]:
                              - generic [ref=e220]: style
                              - text: "=\"position: fixed; z-index: 10000; width: 180px; padding: 6px; border-radius: 14px; background: rgba(30, 30, 34, 0.95); backdrop-filter: blur(30px); border: 1px solid var(--border-strong); box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4); display: flex; flex-direction: column; gap: 2px;\""
                            - text: ">"
                          - button "Expand" [ref=e222]
                          - text: …
                          - generic "</div>" [ref=e224]:
                            - text: <
                            - generic [ref=e225]: /div
                            - text: ">"
                      - treeitem "<!-- NEWTAB CONTAINER TEMPLATE -->" [ref=e227]:
                        - generic [ref=e230]: <!-- NEWTAB CONTAINER TEMPLATE -->
                      - treeitem "<template id=\"newtab-template\"> Expand …</template>" [ref=e232]:
                        - generic [ref=e234]:
                          - generic "<template id=\"newtab-template\">" [ref=e235]:
                            - text: <
                            - generic [ref=e236]: template
                            - generic [ref=e237]:
                              - generic [ref=e238]: id
                              - text: ="newtab-template"
                            - text: ">"
                          - button "Expand" [ref=e240]
                          - text: …
                          - generic "</template>" [ref=e242]:
                            - text: <
                            - generic [ref=e243]: /template
                            - text: ">"
                      - treeitem "<!-- Find Bar -->" [ref=e245]:
                        - generic [ref=e248]: <!-- Find Bar -->
                      - treeitem "<div id=\"find-bar\" class=\"find-bar hidden\"> Expand …</div>" [ref=e250]:
                        - generic [ref=e252]:
                          - generic "<div id=\"find-bar\" class=\"find-bar hidden\">" [ref=e253]:
                            - text: <
                            - generic [ref=e254]: div
                            - generic [ref=e255]:
                              - generic [ref=e256]: id
                              - text: ="find-bar"
                            - generic [ref=e257]:
                              - generic [ref=e258]: class
                              - text: ="find-bar hidden"
                            - text: ">"
                          - button "Expand" [ref=e260]
                          - text: …
                          - generic "</div>" [ref=e262]:
                            - text: <
                            - generic [ref=e263]: /div
                            - text: ">"
                      - treeitem "<!-- CUSTOM CREATE SPACE MODAL -->" [ref=e265]:
                        - generic [ref=e268]: <!-- CUSTOM CREATE SPACE MODAL -->
                      - treeitem "<div id=\"create-space-modal\" class=\"hidden\" style=\"position:fixed; inset:0; z-index:2000; display:flex; align-items:center; justify-content:center; padding:24px;\"> Expand …</div>" [ref=e270]:
                        - generic [ref=e272]:
                          - generic "<div id=\"create-space-modal\" class=\"hidden\" style=\"position:fixed; inset:0; z-index:2000; display:flex; align-items:center; justify-content:center; padding:24px;\">" [ref=e273]:
                            - text: <
                            - generic [ref=e274]: div
                            - generic [ref=e275]:
                              - generic [ref=e276]: id
                              - text: ="create-space-modal"
                            - generic [ref=e277]:
                              - generic [ref=e278]: class
                              - text: ="hidden"
                            - generic [ref=e279]:
                              - generic [ref=e280]: style
                              - text: ="position:fixed; inset:0; z-index:2000; display:flex; align-items:center; justify-content:center; padding:24px;"
                            - text: ">"
                          - button "Expand" [ref=e282]
                          - text: …
                          - generic "</div>" [ref=e284]:
                            - text: <
                            - generic [ref=e285]: /div
                            - text: ">"
                      - treeitem "<!-- A2UI FLOATING GLASS OVERLAY (Renders A2UI Generative Cards ON TOP of opened websites/tabs) -->" [ref=e287]:
                        - generic [ref=e290]: <!-- A2UI FLOATING GLASS OVERLAY (Renders A2UI Generative Cards ON TOP of opened websites/tabs) -->
                      - 'treeitem "<div id=\"a2ui-floating-overlay\" class=\"hidden\" style=\"position: fixed; bottom: 86px; right: 28px; width: 660px; max-width: calc(100vw - 56px); max-height: calc(100vh - 130px); z-index: 99999; background: rgba(10, 12, 22, 0.82); backdrop-filter: blur(36px) saturate(180%); -webkit-backdrop-filter: blur(36px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.16); border-top: 1px solid rgba(255, 255, 255, 0.32); border-radius: 24px; box-shadow: 0 30px 90px rgba(0, 0, 0, 0.75); display: flex; flex-direction: column; overflow: hidden; transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);\"> Expand …</div>" [ref=e292]':
                        - generic [ref=e294]:
                          - 'generic "<div id=\"a2ui-floating-overlay\" class=\"hidden\" style=\"position: fixed; bottom: 86px; right: 28px; width: 660px; max-width: calc(100vw - 56px); max-height: calc(100vh - 130px); z-index: 99999; background: rgba(10, 12, 22, 0.82); backdrop-filter: blur(36px) saturate(180%); -webkit-backdrop-filter: blur(36px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.16); border-top: 1px solid rgba(255, 255, 255, 0.32); border-radius: 24px; box-shadow: 0 30px 90px rgba(0, 0, 0, 0.75); display: flex; flex-direction: column; overflow: hidden; transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);\">" [ref=e295]':
                            - text: <
                            - generic [ref=e296]: div
                            - generic [ref=e297]:
                              - generic [ref=e298]: id
                              - text: ="a2ui-floating-overlay"
                            - generic [ref=e299]:
                              - generic [ref=e300]: class
                              - text: ="hidden"
                            - generic [ref=e301]:
                              - generic [ref=e302]: style
                              - text: "=\"position: fixed; bottom: 86px; right: 28px; width: 660px; max-width: calc(100vw - 56px); max-height: calc(100vh - 130px); z-index: 99999; background: rgba(10, 12, 22, 0.82); backdrop-filter: blur(36px) saturate(180%); -webkit-backdrop-filter: blur(36px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.16); border-top: 1px solid rgba(255, 255, 255, 0.32); border-radius: 24px; box-shadow: 0 30px 90px rgba(0, 0, 0, 0.75); display: flex; flex-direction: column; overflow: hidden; transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);\""
                            - text: ">"
                          - button "Expand" [ref=e304]
                          - text: …
                          - generic "</div>" [ref=e306]:
                            - text: <
                            - generic [ref=e307]: /div
                            - text: ">"
                      - treeitem "<script src=\"tab-view.js\"></script>" [ref=e309]:
                        - generic [ref=e311]:
                          - generic "<script src=\"tab-view.js\">" [ref=e312]:
                            - text: <
                            - generic [ref=e313]: script
                            - generic [ref=e314]:
                              - generic [ref=e315]: src
                              - text: ="
                              - link "tab-view.js" [ref=e317]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e318]:
                            - text: <
                            - generic [ref=e319]: /script
                            - text: ">"
                      - treeitem "<script src=\"agent-browser-control.js\"></script>" [ref=e321]:
                        - generic [ref=e323]:
                          - generic "<script src=\"agent-browser-control.js\">" [ref=e324]:
                            - text: <
                            - generic [ref=e325]: script
                            - generic [ref=e326]:
                              - generic [ref=e327]: src
                              - text: ="
                              - link "agent-browser-control.js" [ref=e329]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e330]:
                            - text: <
                            - generic [ref=e331]: /script
                            - text: ">"
                      - treeitem "<script src=\"nexus-panel.js\"></script>" [ref=e333]:
                        - generic [ref=e335]:
                          - generic "<script src=\"nexus-panel.js\">" [ref=e336]:
                            - text: <
                            - generic [ref=e337]: script
                            - generic [ref=e338]:
                              - generic [ref=e339]: src
                              - text: ="
                              - link "nexus-panel.js" [ref=e341]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e342]:
                            - text: <
                            - generic [ref=e343]: /script
                            - text: ">"
                      - treeitem "<script src=\"pane-manager.js\"></script>" [ref=e345]:
                        - generic [ref=e347]:
                          - generic "<script src=\"pane-manager.js\">" [ref=e348]:
                            - text: <
                            - generic [ref=e349]: script
                            - generic [ref=e350]:
                              - generic [ref=e351]: src
                              - text: ="
                              - link "pane-manager.js" [ref=e353]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e354]:
                            - text: <
                            - generic [ref=e355]: /script
                            - text: ">"
                      - treeitem "<script src=\"canvas-manager.js\"></script>" [ref=e357]:
                        - generic [ref=e359]:
                          - generic "<script src=\"canvas-manager.js\">" [ref=e360]:
                            - text: <
                            - generic [ref=e361]: script
                            - generic [ref=e362]:
                              - generic [ref=e363]: src
                              - text: ="
                              - link "canvas-manager.js" [ref=e365]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e366]:
                            - text: <
                            - generic [ref=e367]: /script
                            - text: ">"
                      - treeitem "<script src=\"app-store-data.js\"></script>" [ref=e369]:
                        - generic [ref=e371]:
                          - generic "<script src=\"app-store-data.js\">" [ref=e372]:
                            - text: <
                            - generic [ref=e373]: script
                            - generic [ref=e374]:
                              - generic [ref=e375]: src
                              - text: ="
                              - link "app-store-data.js" [ref=e377]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e378]:
                            - text: <
                            - generic [ref=e379]: /script
                            - text: ">"
                      - treeitem "<script src=\"app-store.js\"></script>" [ref=e381]:
                        - generic [ref=e383]:
                          - generic "<script src=\"app-store.js\">" [ref=e384]:
                            - text: <
                            - generic [ref=e385]: script
                            - generic [ref=e386]:
                              - generic [ref=e387]: src
                              - text: ="
                              - link "app-store.js" [ref=e389]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e390]:
                            - text: <
                            - generic [ref=e391]: /script
                            - text: ">"
                      - treeitem "<script src=\"bucks-brand.js\"></script>" [ref=e393]:
                        - generic [ref=e395]:
                          - generic "<script src=\"bucks-brand.js\">" [ref=e396]:
                            - text: <
                            - generic [ref=e397]: script
                            - generic [ref=e398]:
                              - generic [ref=e399]: src
                              - text: ="
                              - link "bucks-brand.js" [ref=e401]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e402]:
                            - text: <
                            - generic [ref=e403]: /script
                            - text: ">"
                      - treeitem "<script src=\"a2ui-results.js\"></script>" [ref=e405]:
                        - generic [ref=e407]:
                          - generic "<script src=\"a2ui-results.js\">" [ref=e408]:
                            - text: <
                            - generic [ref=e409]: script
                            - generic [ref=e410]:
                              - generic [ref=e411]: src
                              - text: ="
                              - link "a2ui-results.js" [ref=e413]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e414]:
                            - text: <
                            - generic [ref=e415]: /script
                            - text: ">"
                      - treeitem "<script src=\"a2ui-engine.js\"></script>" [ref=e417]:
                        - generic [ref=e419]:
                          - generic "<script src=\"a2ui-engine.js\">" [ref=e420]:
                            - text: <
                            - generic [ref=e421]: script
                            - generic [ref=e422]:
                              - generic [ref=e423]: src
                              - text: ="
                              - link "a2ui-engine.js" [ref=e425]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e426]:
                            - text: <
                            - generic [ref=e427]: /script
                            - text: ">"
                      - treeitem "<script src=\"renderer.js\"></script>" [ref=e429]:
                        - generic [ref=e431]:
                          - generic "<script src=\"renderer.js\">" [ref=e432]:
                            - text: <
                            - generic [ref=e433]: script
                            - generic [ref=e434]:
                              - generic [ref=e435]: src
                              - text: ="
                              - link "renderer.js" [ref=e437]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e438]:
                            - text: <
                            - generic [ref=e439]: /script
                            - text: ">"
                      - treeitem "<script src=\"messages-ui.js\"></script>" [ref=e441]:
                        - generic [ref=e443]:
                          - generic "<script src=\"messages-ui.js\">" [ref=e444]:
                            - text: <
                            - generic [ref=e445]: script
                            - generic [ref=e446]:
                              - generic [ref=e447]: src
                              - text: ="
                              - link "messages-ui.js" [ref=e449]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e450]:
                            - text: <
                            - generic [ref=e451]: /script
                            - text: ">"
                      - treeitem "<script src=\"soul-ui.js\"></script>" [ref=e453]:
                        - generic [ref=e455]:
                          - generic "<script src=\"soul-ui.js\">" [ref=e456]:
                            - text: <
                            - generic [ref=e457]: script
                            - generic [ref=e458]:
                              - generic [ref=e459]: src
                              - text: ="
                              - link "soul-ui.js" [ref=e461]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e462]:
                            - text: <
                            - generic [ref=e463]: /script
                            - text: ">"
                      - treeitem "<script src=\"nim-panel.js\"></script>" [ref=e465]:
                        - generic [ref=e467]:
                          - generic "<script src=\"nim-panel.js\">" [ref=e468]:
                            - text: <
                            - generic [ref=e469]: script
                            - generic [ref=e470]:
                              - generic [ref=e471]: src
                              - text: ="
                              - link "nim-panel.js" [ref=e473]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e474]:
                            - text: <
                            - generic [ref=e475]: /script
                            - text: ">"
                      - treeitem "<script src=\"benchmark-panel.js\"></script>" [ref=e477]:
                        - generic [ref=e479]:
                          - generic "<script src=\"benchmark-panel.js\">" [ref=e480]:
                            - text: <
                            - generic [ref=e481]: script
                            - generic [ref=e482]:
                              - generic [ref=e483]: src
                              - text: ="
                              - link "benchmark-panel.js" [ref=e485]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e486]:
                            - text: <
                            - generic [ref=e487]: /script
                            - text: ">"
                      - treeitem "<script src=\"ephemeral-ui.js\"></script>" [ref=e489]:
                        - generic [ref=e491]:
                          - generic "<script src=\"ephemeral-ui.js\">" [ref=e492]:
                            - text: <
                            - generic [ref=e493]: script
                            - generic [ref=e494]:
                              - generic [ref=e495]: src
                              - text: ="
                              - link "ephemeral-ui.js" [ref=e497]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e498]:
                            - text: <
                            - generic [ref=e499]: /script
                            - text: ">"
                      - treeitem "<script src=\"bucks-panel.js\"></script>" [ref=e501]:
                        - generic [ref=e503]:
                          - generic "<script src=\"bucks-panel.js\">" [ref=e504]:
                            - text: <
                            - generic [ref=e505]: script
                            - generic [ref=e506]:
                              - generic [ref=e507]: src
                              - text: ="
                              - link "bucks-panel.js" [ref=e509]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e510]:
                            - text: <
                            - generic [ref=e511]: /script
                            - text: ">"
                      - treeitem "<script src=\"agent-composer.js\"></script>" [ref=e513]:
                        - generic [ref=e515]:
                          - generic "<script src=\"agent-composer.js\">" [ref=e516]:
                            - text: <
                            - generic [ref=e517]: script
                            - generic [ref=e518]:
                              - generic [ref=e519]: src
                              - text: ="
                              - link "agent-composer.js" [ref=e521]
                              - text: "\""
                            - text: ">"
                          - generic "</script>" [ref=e522]:
                            - text: <
                            - generic [ref=e523]: /script
                            - text: ">"
                      - treeitem "<div id=\"nexus-panel\"> Expand …</div> Enable flex mode" [ref=e525]:
                        - generic [ref=e526]:
                          - generic [ref=e527]:
                            - generic "<div id=\"nexus-panel\">" [ref=e528]:
                              - text: <
                              - generic [ref=e529]: div
                              - generic [ref=e530]:
                                - generic [ref=e531]: id
                                - text: ="nexus-panel"
                              - text: ">"
                            - button "Expand" [ref=e533]
                            - text: …
                            - generic "</div>" [ref=e535]:
                              - text: <
                              - generic [ref=e536]: /div
                              - text: ">"
                          - button "Enable flex mode" [ref=e539]:
                            - generic [ref=e541]: flex
                      - treeitem "<div id=\"nim-panel-root\"> Expand …</div> Enable flex mode" [ref=e542]:
                        - generic [ref=e543]:
                          - generic [ref=e544]:
                            - generic "<div id=\"nim-panel-root\">" [ref=e545]:
                              - text: <
                              - generic [ref=e546]: div
                              - generic [ref=e547]:
                                - generic [ref=e548]: id
                                - text: ="nim-panel-root"
                              - text: ">"
                            - button "Expand" [ref=e550]
                            - text: …
                            - generic "</div>" [ref=e552]:
                              - text: <
                              - generic [ref=e553]: /div
                              - text: ">"
                          - button "Enable flex mode" [ref=e556]:
                            - generic [ref=e558]: flex
                      - treeitem "<div id=\"bench-panel-root\"> Expand …</div> Enable flex mode" [ref=e559]:
                        - generic [ref=e560]:
                          - generic [ref=e561]:
                            - generic "<div id=\"bench-panel-root\">" [ref=e562]:
                              - text: <
                              - generic [ref=e563]: div
                              - generic [ref=e564]:
                                - generic [ref=e565]: id
                                - text: ="bench-panel-root"
                              - text: ">"
                            - button "Expand" [ref=e567]
                            - text: …
                            - generic "</div>" [ref=e569]:
                              - text: <
                              - generic [ref=e570]: /div
                              - text: ">"
                          - button "Enable flex mode" [ref=e573]:
                            - generic [ref=e575]: flex
                      - treeitem "<>" [ref=e576]:
                        - generic "<>" [ref=e579]:
                          - text: <
                          - generic [ref=e580]: /body
                          - text: ">"
                    - treeitem "<>" [ref=e582]:
                      - generic "<>" [ref=e585]:
                        - text: <
                        - generic [ref=e586]: /html
                        - text: ">"
              - navigation "DOM tree breadcrumbs" [ref=e590]:
                - button "Scroll left" [ref=e591]
                - list [ref=e594]:
                  - listitem [ref=e595]:
                    - link "html" [ref=e596] [cursor=pointer]:
                      - /url: "#"
                      - generic [ref=e598]: html
                  - listitem [ref=e599]:
                    - link "body.platform-darwin.dock-collapsed" [ref=e600] [cursor=pointer]:
                      - /url: "#"
                      - generic [ref=e601]:
                        - generic [ref=e602]: body
                        - generic [ref=e603]: .platform-darwin.dock-collapsed
                - button "Scroll right" [ref=e604]
          - generic [ref=e608]:
            - navigation "Side panel toolbar" [ref=e609]:
              - generic:
                - tablist:
                  - generic "Styles" [ref=e610]:
                    - tab "Styles" [ref=e611]
                  - generic "Computed" [ref=e612]:
                    - tab "Computed" [ref=e613]
                  - generic "Layout" [ref=e614]:
                    - tab "Layout" [ref=e615]
                - button "More tabs" [ref=e616]
            - complementary "Side panel content" [ref=e619]:
              - tabpanel "Computed panel" [ref=e620]:
                - generic [ref=e622]:
                  - generic [ref=e626]:
                    - generic [ref=e627]: margin
                    - generic [ref=e628]: "0"
                    - generic [ref=e629]: "0"
                    - generic [ref=e630]:
                      - generic [ref=e631]: border
                      - generic [ref=e632]: "0"
                      - generic [ref=e633]: "0"
                      - generic [ref=e634]:
                        - generic [ref=e635]: padding
                        - generic [ref=e636]: "0"
                        - generic [ref=e637]: "0"
                        - generic [ref=e638]:
                          - generic [ref=e639]: "1149"
                          - generic [ref=e640]: ×
                          - generic [ref=e641]: "900"
                        - generic [ref=e642]: "0"
                        - generic [ref=e643]: "0"
                      - generic [ref=e644]: "0"
                      - generic [ref=e645]: "0"
                    - generic [ref=e646]: "0"
                    - generic [ref=e647]: "0"
                  - generic [ref=e649]:
                    - generic [ref=e650]:
                      - generic:
                        - generic [ref=e651]:
                          - textbox "Filter" [ref=e655]
                          - generic "Use regular expression" [ref=e656]:
                            - button "Use regular expression" [ref=e657]
                        - generic "Show all" [ref=e659]:
                          - checkbox "Show all" [ref=e660]
                          - generic "Show all" [ref=e661]:
                            - generic: Show all
                        - generic "Group" [ref=e662]:
                          - checkbox "Group" [ref=e663]
                          - generic "Group" [ref=e664]:
                            - generic: Group
                    - tree [ref=e667]:
                      - 'treeitem "CSS property name: background-attachment CSS property value: scroll" [level=1] [ref=e668]':
                        - generic [ref=e673]:
                          - generic [ref=e674]:
                            - generic: background-attachment
                          - 'generic "CSS property value: scroll" [ref=e676]': scroll
                      - 'treeitem "CSS property name: background-clip CSS property value: border-box" [level=1] [ref=e677]':
                        - generic [ref=e682]:
                          - generic [ref=e683]:
                            - generic: background-clip
                          - 'generic "CSS property value: border-box" [ref=e685]': border-box
                      - 'treeitem "CSS property name: background-color CSS property value: rgb(13, 13, 16)" [level=1] [ref=e686]':
                        - generic [ref=e691]:
                          - generic [ref=e692]:
                            - generic: background-color
                          - 'generic "CSS property value: rgb(13, 13, 16)" [ref=e694]':
                            - generic "Shift-click to change color format" [ref=e696]
                            - text: rgb(13, 13, 16)
                      - 'treeitem "CSS property name: background-image CSS property value: none" [level=1] [ref=e698]':
                        - generic [ref=e703]:
                          - generic [ref=e704]:
                            - generic: background-image
                          - 'generic "CSS property value: none" [ref=e706]': none
                      - 'treeitem "CSS property name: background-origin CSS property value: padding-box" [level=1] [ref=e707]':
                        - generic [ref=e712]:
                          - generic [ref=e713]:
                            - generic: background-origin
                          - 'generic "CSS property value: padding-box" [ref=e715]': padding-box
                      - 'treeitem "CSS property name: background-position-x CSS property value: 0%" [level=1] [ref=e716]':
                        - generic [ref=e721]:
                          - generic [ref=e722]:
                            - generic: background-position-x
                          - 'generic "CSS property value: 0%" [ref=e724]': 0%
                      - 'treeitem "CSS property name: background-position-y CSS property value: 0%" [level=1] [ref=e725]':
                        - generic [ref=e730]:
                          - generic [ref=e731]:
                            - generic: background-position-y
                          - 'generic "CSS property value: 0%" [ref=e733]': 0%
                      - 'treeitem "CSS property name: background-repeat CSS property value: repeat" [level=1] [ref=e734]':
                        - generic [ref=e739]:
                          - generic [ref=e740]:
                            - generic: background-repeat
                          - 'generic "CSS property value: repeat" [ref=e742]': repeat
                      - 'treeitem "CSS property name: background-size CSS property value: auto" [level=1] [ref=e743]':
                        - generic [ref=e748]:
                          - generic [ref=e749]:
                            - generic: background-size
                          - 'generic "CSS property value: auto" [ref=e751]': auto
                      - 'treeitem "CSS property name: box-sizing CSS property value: border-box" [level=1] [ref=e752]':
                        - generic [ref=e757]:
                          - generic [ref=e758]:
                            - generic: box-sizing
                          - 'generic "CSS property value: border-box" [ref=e760]': border-box
                      - 'treeitem "CSS property name: color CSS property value: rgb(255, 255, 255)" [level=1] [ref=e761]':
                        - generic [ref=e766]:
                          - generic [ref=e767]:
                            - generic: color
                          - 'generic "CSS property value: rgb(255, 255, 255)" [ref=e769]':
                            - generic "Shift-click to change color format" [ref=e771]
                            - text: rgb(255, 255, 255)
                      - 'treeitem "CSS property name: color-scheme CSS property value: dark" [level=1] [ref=e773]':
                        - generic [ref=e778]:
                          - generic [ref=e779]:
                            - generic: color-scheme
                          - 'generic "CSS property value: dark" [ref=e781]': dark
                      - 'treeitem "CSS property name: display CSS property value: block" [level=1] [ref=e782]':
                        - generic [ref=e787]:
                          - generic [ref=e788]:
                            - generic: display
                          - 'generic "CSS property value: block" [ref=e790]': block
                      - 'treeitem "CSS property name: font-family CSS property value: \"Instrument Sans\", system-ui, -apple-system, sans-serif" [level=1] [ref=e791]':
                        - generic [ref=e796]:
                          - generic [ref=e797]:
                            - generic: font-family
                          - 'generic "CSS property value: \"Instrument Sans\", system-ui, -apple-system, sans-serif" [ref=e799]': "\"Instrument Sans\", system-ui, -apple-system, sans-serif"
                      - 'treeitem "CSS property name: height CSS property value: 900px" [level=1] [ref=e800]':
                        - generic [ref=e805]:
                          - generic [ref=e806]:
                            - generic: height
                          - 'generic "CSS property value: 900px" [ref=e808]': 900px
                      - 'treeitem "CSS property name: margin-bottom CSS property value: 0px" [level=1] [ref=e809]':
                        - generic [ref=e814]:
                          - generic [ref=e815]:
                            - generic: margin-bottom
                          - 'generic "CSS property value: 0px" [ref=e817]': 0px
                      - 'treeitem "CSS property name: margin-left CSS property value: 0px" [level=1] [ref=e818]':
                        - generic [ref=e823]:
                          - generic [ref=e824]:
                            - generic: margin-left
                          - 'generic "CSS property value: 0px" [ref=e826]': 0px
                      - 'treeitem "CSS property name: margin-right CSS property value: 0px" [level=1] [ref=e827]':
                        - generic [ref=e832]:
                          - generic [ref=e833]:
                            - generic: margin-right
                          - 'generic "CSS property value: 0px" [ref=e835]': 0px
                      - 'treeitem "CSS property name: margin-top CSS property value: 0px" [level=1] [ref=e836]':
                        - generic [ref=e841]:
                          - generic [ref=e842]:
                            - generic: margin-top
                          - 'generic "CSS property value: 0px" [ref=e844]': 0px
                      - 'treeitem "CSS property name: overflow-x CSS property value: hidden" [level=1] [ref=e845]':
                        - generic [ref=e850]:
                          - generic [ref=e851]:
                            - generic: overflow-x
                          - 'generic "CSS property value: hidden" [ref=e853]': hidden
                      - 'treeitem "CSS property name: overflow-y CSS property value: hidden" [level=1] [ref=e854]':
                        - generic [ref=e859]:
                          - generic [ref=e860]:
                            - generic: overflow-y
                          - 'generic "CSS property value: hidden" [ref=e862]': hidden
                      - 'treeitem "CSS property name: padding-bottom CSS property value: 0px" [level=1] [ref=e863]':
                        - generic [ref=e868]:
                          - generic [ref=e869]:
                            - generic: padding-bottom
                          - 'generic "CSS property value: 0px" [ref=e871]': 0px
                      - 'treeitem "CSS property name: padding-left CSS property value: 0px" [level=1] [ref=e872]':
                        - generic [ref=e877]:
                          - generic [ref=e878]:
                            - generic: padding-left
                          - 'generic "CSS property value: 0px" [ref=e880]': 0px
                      - 'treeitem "CSS property name: padding-right CSS property value: 0px" [level=1] [ref=e881]':
                        - generic [ref=e886]:
                          - generic [ref=e887]:
                            - generic: padding-right
                          - 'generic "CSS property value: 0px" [ref=e889]': 0px
                      - 'treeitem "CSS property name: padding-top CSS property value: 0px" [level=1] [ref=e890]':
                        - generic [ref=e895]:
                          - generic [ref=e896]:
                            - generic: padding-top
                          - 'generic "CSS property value: 0px" [ref=e898]': 0px
                      - 'treeitem "CSS property name: user-select CSS property value: none" [level=1] [ref=e899]':
                        - generic [ref=e904]:
                          - generic [ref=e905]:
                            - generic: user-select
                          - 'generic "CSS property value: none" [ref=e907]': none
                      - 'treeitem "CSS property name: width CSS property value: 1149px" [level=1] [ref=e908]':
                        - generic [ref=e913]:
                          - generic [ref=e914]:
                            - generic: width
                          - 'generic "CSS property value: 1149px" [ref=e916]': 1149px
  - alert [ref=e919]: DevTools is docked to right
  - status
```

# Test source

```ts
  1   | const { _electron: electron } = require('playwright');
  2   | const { test, expect } = require('@playwright/test');
  3   | 
  4   | test.describe('Bucks E2E & Visual Regression Suite', () => {
  5   |   let electronApp;
  6   |   let page;
  7   | 
  8   |   test.beforeAll(async () => {
  9   |     // Launch Electron and await the shell window. In dev the app also opens
  10  |     // a DevTools window, so firstWindow() is racy — select by URL instead.
  11  |     electronApp = await electron.launch({
  12  |       args: ['.'],
  13  |       env: { ...process.env, BUCKS_TESTING: '1' }
  14  |     });
  15  |     const deadline = Date.now() + 20000;
  16  |     for (;;) {
  17  |       page = electronApp.windows().find(w => w.url().includes('index.html'));
  18  |       if (page) break;
  19  |       if (Date.now() > deadline) throw new Error('Shell window (index.html) never appeared');
  20  |       await new Promise(r => setTimeout(r, 250));
  21  |     }
  22  |     page.on('console', msg => console.log(`[E2E CONSOLE] ${msg.type()}: ${msg.text()}`));
  23  |     page.on('pageerror', err => console.log(`[E2E PAGE ERROR]: ${err.message}`));
  24  |     await page.waitForLoadState('domcontentloaded');
  25  |     // Deterministic boot: drop any restored session from earlier runs/usage,
  26  |     // then reload so the suite always starts from a single fresh tab.
  27  |     await page.evaluate(() => localStorage.removeItem('bucks-session-v2'));
  28  |     await page.reload();
  29  |     await page.waitForLoadState('domcontentloaded');
  30  |     await page.waitForTimeout(1500);
  31  |   });
  32  | 
  33  |   test.afterAll(async () => {
  34  |     await electronApp.close();
  35  |   });
  36  | 
  37  |   test('Smoke Test: App boot and persistent elements', async () => {
  38  |     expect(await page.title()).toBe('Bucks Browser');
  39  | 
  40  |     // Verify address bar is present and functional
  41  |     const addressBar = page.locator('#address-bar');
  42  |     await expect(addressBar).toBeVisible();
  43  | 
  44  |     // The agent chat panel is on-demand: it must exist in the DOM but stay
  45  |     // hidden until the user opens it from the omnibar / new-tab zone.
  46  |     const agentPanel = page.locator('#nav-chat-panel');
  47  |     await expect(agentPanel).toBeAttached();
  48  |     await expect(agentPanel).toBeHidden();
  49  |   });
  50  | 
  51  |   test('Visual Regression: omnibar chrome', async () => {
  52  |     // The chat panel is transient (docks in and out around chat turns), so
  53  |     // the persistent omnibar area is the stable regression target.
  54  |     const omnibar = page.locator('#url-search-wrap');
  55  |     await expect(omnibar).toBeVisible();
> 56  |     await expect(omnibar).toHaveScreenshot('omnibar-chrome.png', {
      |                           ^ Error: expect(locator).toHaveScreenshot(expected) failed
  57  |       maxDiffPixelRatio: 0.05
  58  |     });
  59  |   });
  60  | 
  61  |   test('Spatial layout: page renders in the stage, clear of the agent dock', async () => {
  62  |     // Navigate via the global agent bar (URL input → tab navigation).
  63  |     await page.fill('#nt-search-input', 'https://example.com');
  64  |     await page.press('#nt-search-input', 'Enter');
  65  |     await page.waitForTimeout(3500);
  66  | 
  67  |     const shell = await page.evaluate(() => {
  68  |       const bar = document.getElementById('composer-bar');
  69  |       return {
  70  |         webMode: document.body.classList.contains('web-mode'),
  71  |         barTop: bar ? bar.getBoundingClientRect().top : null,
  72  |         inner: [innerWidth, innerHeight],
  73  |       };
  74  |     });
  75  |     expect(shell.webMode).toBe(true);
  76  |     expect(shell.barTop).not.toBeNull();
  77  | 
  78  |     // The native WebContentsView must stop above the agent dock band — the
  79  |     // dock is shell DOM and a native view would otherwise paint over it.
  80  |     const views = await electronApp.evaluate(({ BrowserWindow }) => {
  81  |       const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
  82  |       return win.contentView.children.map((v) => ({ bounds: v.getBounds(), visible: v.getVisible() }));
  83  |     });
  84  |     const active = views.find((v) => v.visible);
  85  |     expect(active).toBeTruthy();
  86  |     expect(active.bounds.y + active.bounds.height).toBeLessThanOrEqual(shell.barTop);
  87  |   });
  88  | 
  89  |   test('Spatial panes: split, geometry, agent tools, unsplit', async () => {
  90  |     // Runs after the spatial-layout test, so the active tab shows example.com.
  91  |     await page.click('#btn-split');
  92  |     await page.waitForTimeout(2500);
  93  | 
  94  |     // Shell DOM: a stage with two pane frames, each with a header.
  95  |     const shellState = await page.evaluate(() => ({
  96  |       stages: document.querySelectorAll('.pane-stage.active').length,
  97  |       frames: document.querySelectorAll('.pane-stage.active .pane-frame').length,
  98  |       headers: document.querySelectorAll('.pane-stage.active .pane-header').length,
  99  |       focused: document.querySelectorAll('.pane-frame.focused').length,
  100 |     }));
  101 |     expect(shellState.stages).toBe(1);
  102 |     expect(shellState.frames).toBe(2);
  103 |     expect(shellState.headers).toBe(2);
  104 |     expect(shellState.focused).toBe(1);
  105 | 
  106 |     // Native plane: two visible views, side by side, both clear of the dock
  107 |     // band and neither covering the other's pane header.
  108 |     const barTop = await page.evaluate(() =>
  109 |       document.getElementById('composer-bar').getBoundingClientRect().top);
  110 |     const views = await electronApp.evaluate(({ BrowserWindow }) => {
  111 |       const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
  112 |       return win.contentView.children.map((v) => ({ bounds: v.getBounds(), visible: v.getVisible() }));
  113 |     });
  114 |     const vis = views.filter((v) => v.visible);
  115 |     expect(vis.length).toBe(2);
  116 |     for (const v of vis) expect(v.bounds.y + v.bounds.height).toBeLessThanOrEqual(barTop);
  117 |     const [a, b] = vis.map((v) => v.bounds).sort((p, q) => p.x - q.x);
  118 |     expect(a.x + a.width).toBeLessThanOrEqual(b.x + 2); // no horizontal overlap
  119 | 
  120 |     // Agent surface: panes_list and workspace_sweep run end-to-end (same
  121 |     // dispatcher the soul engine's browser_action events hit).
  122 |     const paneList = await page.evaluate(() => window.__bucksBrowserControl.execute('panes_list', {}));
  123 |     expect(paneList).toContain('[p');
  124 |     expect(paneList).toContain('example.com');
  125 | 
  126 |     const sweep = await page.evaluate(() => window.__bucksBrowserControl.execute('workspace_sweep', {}));
  127 |     expect(sweep).toContain('Swept 2 pane(s)');
  128 |     expect(sweep.toLowerCase()).toContain('example domain');
  129 | 
  130 |     // Close one pane → workspace collapses back to a plain full-stage tab.
  131 |     const closed = await page.evaluate(() => {
  132 |       const pm = window.bucksPaneManager;
  133 |       const tabId = document.querySelector('.pane-stage.active').dataset.tabId;
  134 |       const panes = pm.listPanes(tabId);
  135 |       return pm.closePane(tabId, panes[1].id);
  136 |     });
  137 |     expect(closed).toBe(true);
  138 |     await page.waitForTimeout(800);
  139 |     const after = await page.evaluate(() => ({
  140 |       stages: document.querySelectorAll('.pane-stage').length,
  141 |       hosts: document.querySelectorAll('#browser-content > .webview-host').length,
  142 |     }));
  143 |     expect(after.stages).toBe(0);
  144 |     expect(after.hosts).toBeGreaterThanOrEqual(1);
  145 |   });
  146 | 
  147 |   test('Performance Benchmarks: Memory Limits', async () => {
  148 |     // Pull main process memory usage statistics via the bucksAPI preload bridge
  149 |     const memory = await page.evaluate(async () => {
  150 |       if (window.bucksAPI && typeof window.bucksAPI.getMemoryUsage === 'function') {
  151 |         return await window.bucksAPI.getMemoryUsage();
  152 |       }
  153 |       return null;
  154 |     });
  155 | 
  156 |     if (memory) {
```
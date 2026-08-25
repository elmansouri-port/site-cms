// ========== LAURENN-MAIN ANIMATIONS PORTED TO VANILLA JS ==========

function initAllAnimations() {
    initScrollMorphingArch();
    initAnimatedCounters();
    initCTAMouseGlow();
    initSlidingPillTabs();
    initUnifiedPlatformTabs();
    initExpandOnHoverCards();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllAnimations);
} else {
    initAllAnimations();
}

// ========== SCROLL-MORPHING ARCH ANIMATION ==========
// Morphs from convex (corners at y=120, controls at y=0) 
// to concave (corners at y=0, controls at y=120)

function initScrollMorphingArch() {
    var fillPath = document.getElementById('arch-fill-path');
    var strokePath = document.getElementById('arch-stroke-path');
    
    if (!fillPath || !strokePath) return;

    var SCROLL_START = 100;
    var SCROLL_END = 720;

    function easeInOut(t) {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    function updateArch() {
        var scrollY = window.scrollY || window.pageYOffset;
        var raw = Math.min(Math.max((scrollY - SCROLL_START) / (SCROLL_END - SCROLL_START), 0), 1);
        var p = easeInOut(raw);

        var cornerY = 120 - p * 120;
        var controlY = p * 120;

        var fill = 'M0,' + cornerY + ' C480,' + controlY + ' 960,' + controlY + ' 1440,' + cornerY + ' L1440,400 L0,400 Z';
        var stroke = 'M0,' + cornerY + ' C480,' + controlY + ' 960,' + controlY + ' 1440,' + cornerY;

        fillPath.setAttribute('d', fill);
        strokePath.setAttribute('d', stroke);
    }

    window.addEventListener('scroll', updateArch, { passive: true });
    updateArch();
}

// ========== ANIMATED COUNTERS ==========
// Uses requestAnimationFrame for smooth counting

function initAnimatedCounters() {
    var counterEls = document.querySelectorAll('[data-counter]');
    if (!counterEls.length) return;

    var countersStarted = new WeakMap();

    function animateCounter(el) {
        var targetStr = el.getAttribute('data-counter');
        var isFloat = targetStr.indexOf('.') > -1 || targetStr.indexOf(',') > -1;
        var target = parseFloat(targetStr.replace(',', '.'));
        var duration = parseInt(el.getAttribute('data-duration') || '2000', 10);
        var startTime = null;

        function update(timestamp) {
            if (!startTime) startTime = timestamp;
            var progress = Math.min((timestamp - startTime) / duration, 1);
            
            var easeOut = 1 - Math.pow(1 - progress, 3);
            var current = easeOut * target;
            
            if (isFloat) {
                // Format with 1 decimal place and replace dot with comma for French locale
                el.textContent = current.toFixed(1).replace('.', ',');
            } else {
                el.textContent = Math.round(current).toLocaleString();
            }
            
            if (progress < 1) {
                requestAnimationFrame(update);
            } else {
                // Ensure final value is exact
                if (isFloat) {
                    el.textContent = target.toFixed(1).replace('.', ',');
                } else {
                    el.textContent = Math.round(target).toLocaleString();
                }
            }
        }

        requestAnimationFrame(update);
    }

    var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            var el = entry.target;
            
            if (entry.isIntersecting && !countersStarted.has(el)) {
                countersStarted.set(el, true);
                animateCounter(el);
            }
        });
    }, { threshold: 0.3, rootMargin: '0px 0px -50px 0px' });

    counterEls.forEach(function(el) {
        observer.observe(el);
    });
}

// ========== CTA MOUSE GLOW EFFECT ==========
// Tracks mouse position and updates CSS variables for radial gradient

function initCTAMouseGlow() {
    var ctaBanners = document.querySelectorAll('.sp-cta-banner-dark');
    
    ctaBanners.forEach(function(banner) {
        banner.addEventListener('mousemove', function(e) {
            var rect = banner.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            banner.style.setProperty('--mouse-x', x + 'px');
            banner.style.setProperty('--mouse-y', y + 'px');
        });
    });
}

// ========== SLIDING PILL TABS (Target Audience) ==========
// Spring-like sliding pill animation

function initSlidingPillTabs() {
    var container = document.querySelector('.pill-tab-container');
    var slider = document.querySelector('.pill-slider');
    var tabs = document.querySelectorAll('.pill-tab-btn');
    
    if (!container || !slider || !tabs.length) return;

    function updatePillPosition(index) {
        var activeTab = tabs[index];
        if (!activeTab) return;
        
        slider.style.left = activeTab.offsetLeft + 'px';
        slider.style.width = activeTab.offsetWidth + 'px';
    }

    tabs.forEach(function(tab, clickIndex) {
        tab.addEventListener('click', function() {
            var tabIndex = parseInt(tab.getAttribute('data-tab-index') || clickIndex, 10);
            
            // Update button text styles
            tabs.forEach(function(t, i) {
                if (i === clickIndex) {
                    t.classList.remove('text-inactive');
                    t.classList.add('text-active');
                } else {
                    t.classList.remove('text-active');
                    t.classList.add('text-inactive');
                }
            });
            
            updatePillPosition(clickIndex);
            
            // Update text panels using inline styles for reliability
            var allPanels = document.querySelectorAll('.tab-panel-content');
            allPanels.forEach(function(panel) {
                var panelIndex = parseInt(panel.getAttribute('data-panel-index'), 10);
                if (panelIndex === tabIndex) {
                    // Show this panel
                    panel.style.opacity = '1';
                    panel.style.visibility = 'visible';
                    panel.style.position = 'relative';
                    panel.style.pointerEvents = 'auto';
                    panel.style.transform = 'translateX(0)';
                    panel.style.zIndex = '10';
                } else {
                    // Hide other panels
                    panel.style.opacity = '0';
                    panel.style.visibility = 'hidden';
                    panel.style.position = 'absolute';
                    panel.style.top = '0';
                    panel.style.left = '0';
                    panel.style.width = '100%';
                    panel.style.pointerEvents = 'none';
                    panel.style.transform = 'translateX(20px)';
                    panel.style.zIndex = '0';
                }
            });
            
            // Update images (they're in a separate container)
            var allImgs = document.querySelectorAll('.tab-img');
            allImgs.forEach(function(img) {
                var imgIndex = parseInt(img.getAttribute('data-img-index'), 10);
                if (imgIndex === tabIndex) {
                    img.style.opacity = '1';
                    img.style.filter = 'blur(0)';
                    img.style.zIndex = '10';
                } else {
                    img.style.opacity = '0';
                    img.style.filter = 'blur(4px)';
                    img.style.zIndex = '0';
                }
            });
        });
    });

    setTimeout(function() {
        updatePillPosition(0);
        // Initialize image states: image 0 visible, others hidden
        var allImgs = document.querySelectorAll('.tab-img');
        allImgs.forEach(function(img) {
            var idx = parseInt(img.getAttribute('data-img-index'), 10);
            if (idx === 0) {
                img.style.opacity = '1';
                img.style.filter = 'blur(0)';
                img.style.zIndex = '10';
            } else {
                img.style.opacity = '0';
                img.style.filter = 'blur(4px)';
                img.style.zIndex = '0';
            }
        });
    }, 50);

    window.addEventListener('resize', function() {
        var activeIndex = 0;
        tabs.forEach(function(t, i) {
            if (t.classList.contains('text-active')) activeIndex = i;
        });
        updatePillPosition(activeIndex);
    });
}

// ========== UNIFIED PLATFORM TABS WITH PROGRESS BARS ==========
// Auto-rotating tabs with animated progress indicators

function initUnifiedPlatformTabs() {
    var tabItems = document.querySelectorAll('.platform-tab-item');
    if (!tabItems.length) return;

    var activeIndex = 0;
    var totalTabs = tabItems.length;
    var autoPlayInterval = null;
    var TAB_DURATION = 6000;

    // Every tab expands to the SAME height (the tallest content) and the quote
    // block is locked to its tallest quote, so switching tabs never changes the
    // left column height  which also stops the image from re-centering.
    var maxContentHeight = 0;

    function measurePlatformHeights() {
        // Tallest tab content (measure with transitions off and height freed,
        // synchronously, so nothing is painted mid-measure).
        var m = 0;
        tabItems.forEach(function(item) {
            var c = item.querySelector('.platform-tab-content');
            if (!c) return;
            var prev = { t: c.style.transition, h: c.style.height, mh: c.style.maxHeight };
            c.style.transition = 'none';
            c.style.height = 'auto';
            c.style.maxHeight = 'none';
            m = Math.max(m, c.scrollHeight);
            c.style.height = prev.h;
            c.style.maxHeight = prev.mh;
            void c.offsetWidth;
            c.style.transition = prev.t;
        });
        if (m > 0) maxContentHeight = m;

        // Tallest quote: fix the container height and center every quote in it,
        // so switching only fades opacity  zero reflow.
        var qc = document.getElementById('platform-quote');
        if (qc) {
            var qs = qc.querySelectorAll('.quote-item');
            var mq = 0;
            qs.forEach(function(q) {
                q.style.position = 'absolute';
                q.style.top = '50%';
                q.style.left = '0';
                q.style.width = '100%';
                q.style.transform = 'translateY(-50%)';
                mq = Math.max(mq, q.offsetHeight);
            });
            if (mq > 0) qc.style.height = mq + 'px';
        }

        // Mobile: lock the text area to its tallest panel.
        var firstMobile = document.querySelector('.platform-mobile-text');
        if (firstMobile) {
            var mobileWrap = firstMobile.parentElement;
            var mm = 0;
            mobileWrap.querySelectorAll('.platform-mobile-text').forEach(function(el) {
                var wasHidden = el.classList.contains('hidden');
                el.classList.remove('hidden');
                mm = Math.max(mm, el.offsetHeight);
                if (wasHidden) el.classList.add('hidden');
            });
            if (mm > 0) mobileWrap.style.minHeight = mm + 'px';
        }

        lockTabsWrapperHeight();
    }

    // The active tab's TITLE is also bigger (text-lg -> text-2xl) and the long
    // one wraps onto two lines, which changes the column height on its own.
    // Simulate each of the three "tab N active" states (synchronously, nothing
    // is painted), take the tallest total, and lock the tabs wrapper to it.
    function lockTabsWrapperHeight() {
        var wrap = tabItems[0] ? tabItems[0].parentElement : null;
        if (!wrap || !wrap.offsetParent || !maxContentHeight) return;
        wrap.style.minHeight = '';

        var saved = [];
        tabItems.forEach(function(item) {
            var title = item.querySelector('.platform-tab-title');
            var content = item.querySelector('.platform-tab-content');
            saved.push({
                title: title,
                content: content,
                titleClass: title ? title.getAttribute('class') : null,
                h: content ? content.style.height : '',
                mh: content ? content.style.maxHeight : '',
                tr: content ? content.style.transition : ''
            });
            if (content) content.style.transition = 'none';
        });

        var maxTotal = 0;
        for (var s = 0; s < tabItems.length; s++) {
            saved.forEach(function(st, i) {
                if (st.title) {
                    if (i === s) {
                        st.title.classList.remove('text-lg', 'text-gray-400');
                        st.title.classList.add('text-xl', 'md:text-2xl');
                    } else {
                        st.title.classList.remove('text-xl', 'md:text-2xl');
                        st.title.classList.add('text-lg');
                    }
                }
                if (st.content) {
                    st.content.style.maxHeight = 'none';
                    st.content.style.height = (i === s) ? maxContentHeight + 'px' : '0px';
                }
            });
            maxTotal = Math.max(maxTotal, wrap.offsetHeight);
        }

        // Restore everything exactly as it was.
        saved.forEach(function(st) {
            if (st.title && st.titleClass !== null) st.title.setAttribute('class', st.titleClass);
            if (st.content) {
                st.content.style.height = st.h;
                st.content.style.maxHeight = st.mh;
                void st.content.offsetWidth;
                st.content.style.transition = st.tr;
            }
        });

        if (maxTotal > 0) wrap.style.minHeight = maxTotal + 'px';
    }

    tabItems.forEach(function(item, index) {
        item.addEventListener('click', function() {
            stopAutoPlay();
            switchToTab(index);
        });
    });

    // Mobile dot navigation
    var dots = document.querySelectorAll('.platform-dot');
    dots.forEach(function(dot, index) {
        dot.addEventListener('click', function() {
            stopAutoPlay();
            switchToTab(index);
        });
    });

    function switchToTab(index) {
        activeIndex = index;
        
        tabItems.forEach(function(item, i) {
            var track = item.querySelector('.platform-tab-track');
            var progress = item.querySelector('.platform-tab-progress');
            var title = item.querySelector('.platform-tab-title');
            var content = item.querySelector('.platform-tab-content');
            
            if (i === index) {
                item.classList.add('active');
                if (progress) {
                    progress.classList.remove('done');
                    progress.classList.remove('animating');
                    void progress.offsetWidth;
                    progress.classList.add('animating');
                }
                if (title) {
                    title.style.color = item.getAttribute('data-color') || '#5e2d91';
                    title.classList.remove('text-gray-400', 'text-lg');
                    title.classList.add('text-xl', 'md:text-2xl');
                }
                if (content) {
                    content.style.opacity = '1';
                    // All tabs open to the same (tallest) height so the section
                    // never changes height when switching. Falls back to the
                    // tab's own height if measurement hasn't run (mobile init).
                    var target = maxContentHeight || content.scrollHeight;
                    content.style.maxHeight = target + 'px';
                    content.style.height = target + 'px';
                }
            } else {
                item.classList.remove('active');
                if (progress) {
                    progress.classList.remove('animating');
                    progress.classList.add('done');
                }
                if (title) {
                    title.style.color = '#9ca3af';
                    title.classList.remove('text-xl', 'md:text-2xl');
                    title.classList.add('text-lg', 'text-gray-400');
                }
                if (content) {
                    content.style.maxHeight = '0';
                    content.style.height = '0';
                    content.style.opacity = '0';
                }
            }
        });

        var wrapper = document.getElementById('platform-image-wrapper');
        if (wrapper) {
            var imgs = wrapper.querySelectorAll('.platform-image');
            imgs.forEach(function(img, i) {
                if (i === index) {
                    img.style.opacity = '1';
                    img.style.filter = 'blur(0)';
                    img.style.zIndex = '10';
                } else {
                    img.style.opacity = '0';
                    img.style.filter = 'blur(4px)';
                    img.style.zIndex = '0';
                }
            });
        }

        // Mobile images (natural flow, display-based switching)
        var mobileWrapper = document.getElementById('platform-mobile-image-wrapper');
        if (mobileWrapper) {
            var mobileImgs = mobileWrapper.querySelectorAll('.platform-mobile-image');
            mobileImgs.forEach(function(img, i) {
                if (i === index) {
                    img.classList.remove('hidden');
                    img.classList.add('block');
                } else {
                    img.classList.remove('block');
                    img.classList.add('hidden');
                }
            });
        }

        // Mobile text panels
        var mobileTexts = document.querySelectorAll('.platform-mobile-text');
        mobileTexts.forEach(function(el) {
            var idx = parseInt(el.getAttribute('data-platform-index'), 10);
            if (idx === index) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });

        // Mobile dots
        var dots = document.querySelectorAll('.platform-dot');
        var dotColors = ['#5e2d91', '#0085CA', '#ea5800'];
        dots.forEach(function(dot) {
            var idx = parseInt(dot.getAttribute('data-platform-index'), 10);
            if (idx === index) {
                dot.style.backgroundColor = dotColors[idx] || '#5e2d91';
            } else {
                dot.style.backgroundColor = '#d1d5db';
            }
        });

        // Quotes are all absolutely positioned & centered in a fixed-height
        // container (see measurePlatformHeights), so switching is a pure fade.
        var quoteContainer = document.getElementById('platform-quote');
        if (quoteContainer) {
            var quotes = quoteContainer.querySelectorAll('.quote-item');
            quotes.forEach(function(q) {
                var qi = parseInt(q.getAttribute('data-quote-index'), 10);
                q.style.opacity = (qi === index) ? '1' : '0';
                q.style.pointerEvents = (qi === index) ? 'auto' : 'none';
            });
        }
    }

    function startAutoPlay() {
        if (autoPlayInterval) clearInterval(autoPlayInterval);
        autoPlayInterval = setInterval(function() {
            activeIndex = (activeIndex + 1) % totalTabs;
            switchToTab(activeIndex);
        }, TAB_DURATION);
    }

    function stopAutoPlay() {
        if (autoPlayInterval) {
            clearInterval(autoPlayInterval);
            autoPlayInterval = null;
        }
    }

    // Re-measure once fonts/layout settle (and on resize), otherwise the
    // heights locked at init can be too small and clip content once the real
    // font renders  then re-apply the locked height to the open tab.
    function refreshActiveHeight() {
        measurePlatformHeights();
        var active = document.querySelector('.platform-tab-item.active .platform-tab-content');
        if (active) {
            var target = maxContentHeight || active.scrollHeight;
            active.style.maxHeight = target + 'px';
            active.style.height = target + 'px';
        }
    }

    window.addEventListener('resize', refreshActiveHeight);
    window.addEventListener('load', refreshActiveHeight);
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(refreshActiveHeight);
    }

    measurePlatformHeights();
    switchToTab(0);
    startAutoPlay();
}



// ========== EXPAND ON HOVER CARDS (Testimonials Section) ==========

function initExpandOnHoverCards() {
    var cards = document.querySelectorAll('.expand-card');
    if (!cards.length) return;

    var activeCardId = 2; // Default to card 2 (Responsable Formation)

    function expandCard(targetId) {
        activeCardId = targetId;
        
        cards.forEach(function(card) {
            var cardId = parseInt(card.getAttribute('data-card-id'), 10);
            if (cardId === targetId) {
                card.classList.add('expanded');
            } else {
                card.classList.remove('expanded');
            }
        });
    }

    cards.forEach(function(card) {
        var cardId = parseInt(card.getAttribute('data-card-id'), 10);
        
        // Mouse enter - expand this card
        card.addEventListener('mouseenter', function() {
            expandCard(cardId);
        });
        
        // Click - expand this card
        card.addEventListener('click', function() {
            expandCard(cardId);
        });
    });

    // Initialize with card 2 expanded
    expandCard(activeCardId);
}

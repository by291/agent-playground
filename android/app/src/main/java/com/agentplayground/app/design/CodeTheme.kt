package com.agentplayground.app.design

import dev.snipme.highlights.model.SyntaxTheme

/** Syntax colors must remain readable on the theme's code-panel surface. */
internal fun codeSyntaxTheme(dark: Boolean): SyntaxTheme =
    if (dark) {
        SyntaxTheme.basic(
            key = "playground",
            code = 0xE7EBF2,
            string = 0xE4BE90,
            accent = 0xA9C1FF,
            value = 0xCAB4ED,
            comment = 0xAEB8C7,
        )
    } else {
        SyntaxTheme.basic(
            key = "playground",
            code = 0x20252D,
            string = 0x775638,
            accent = 0x315FD1,
            value = 0x7950A0,
            comment = 0x606A78,
        )
    }

package io.nexy.android.ui.icons

import android.animation.ValueAnimator
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Icon
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.ui.graphics.vector.ImageVector
import io.nexy.android.ui.theme.LocalNexyEightBit

enum class NexyIconName {
    Add,
    Agent,
    Archive,
    Artifact,
    Attach,
    Busy,
    Check,
    CheckedBox,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    Close,
    Copy,
    Compress,
    Delete,
    Edit,
    Error,
    File,
    Folder,
    Fork,
    Expand,
    History,
    Image,
    Home,
    Inbox,
    Import,
    Inspect,
    Microphone,
    More,
    Pause,
    Pin,
    Play,
    Project,
    Prompt,
    Rating,
    Refresh,
    Scan,
    Scheduled,
    Search,
    Send,
    Share,
    Settings,
    Skill,
    Spark,
    Stop,
    Tool,
    Download,
    Upload,
    Workflow,
    Warning,
}

enum class NexyIconMotion {
    Default,
    Spin,
    None,
}

private val patterns: Map<NexyIconName, List<String>> = mapOf(
    NexyIconName.Add to listOf(
        "        ", "   ##   ", "   ##   ", " ###### ",
        " ###### ", "   ##   ", "   ##   ", "        ",
    ),
    NexyIconName.Agent to listOf(
        "  ####  ", " ##  ## ", " ##  ## ", "  ####  ",
        " ###### ", "## ## ##", "##    ##", "        ",
    ),
    NexyIconName.Archive to listOf(
        "########", "#      #", "########", " ##  ## ",
        " ##  ## ", " ##  ## ", " ###### ", "        ",
    ),
    NexyIconName.Artifact to listOf(
        " ####   ", " #  ##  ", " #   #  ", " #   #  ",
        " #   #  ", " #   #  ", " #####  ", "        ",
    ),
    NexyIconName.Attach to listOf(
        "  ####  ", "  #  #  ", "#### #  ", "#  # #  ",
        "#  ###  ", "#       ", "######  ", "        ",
    ),
    NexyIconName.Busy to listOf(
        "###  ###", "#      #", "#      #", "        ",
        "        ", "#      #", "#      #", "###  ###",
    ),
    NexyIconName.Check to listOf(
        "        ", "      ##", "     ## ", "##  ##  ",
        " ####   ", "  ##    ", "        ", "        ",
    ),
    NexyIconName.CheckedBox to listOf(
        "########", "##    ##", "##   ###", "##  ####",
        "##### ##", " #### ##", "##    ##", "########",
    ),
    NexyIconName.ChevronDown to listOf(
        "        ", "        ", " ##  ## ", " ##  ## ",
        "  ####  ", "   ##   ", "        ", "        ",
    ),
    NexyIconName.ChevronRight to listOf(
        "        ", "  ##    ", "   ##   ", "    ##  ",
        "    ##  ", "   ##   ", "  ##    ", "        ",
    ),
    NexyIconName.ChevronUp to listOf(
        "        ", "   ##   ", "  ####  ", " ##  ## ",
        " ##  ## ", "        ", "        ", "        ",
    ),
    NexyIconName.Close to listOf(
        "##    ##", " ##  ## ", "  ####  ", "   ##   ",
        "  ####  ", " ##  ## ", "##    ##", "        ",
    ),
    NexyIconName.Copy to listOf(
        "  ##### ", "  #   # ", "####  # ", "#  #  # ",
        "#  #### ", "#     # ", "####### ", "        ",
    ),
    NexyIconName.Compress to listOf(
        "##    ##", " ##  ## ", "  ####  ", "   ##   ",
        "  ####  ", " ##  ## ", "##    ##", "        ",
    ),
    NexyIconName.Delete to listOf(
        "  ####  ", "########", " ##  ## ", " ##  ## ",
        " ##  ## ", " ##  ## ", "  ####  ", "        ",
    ),
    NexyIconName.Edit to listOf(
        "      ##", "     ###", "    ### ", "   ###  ",
        "  ###   ", " ###    ", "###     ", "        ",
    ),
    NexyIconName.Error to listOf(
        "  ####  ", " ##  ## ", "## ## ##", "## ## ##",
        "##    ##", " ##  ## ", "  ####  ", "        ",
    ),
    NexyIconName.File to listOf(
        " ####   ", " #  ##  ", " #   #  ", " #   #  ",
        " #   #  ", " #   #  ", " #####  ", "        ",
    ),
    NexyIconName.Folder to listOf(
        "        ", " ###    ", " # #### ", " #    # ",
        " #    # ", " #    # ", " ###### ", "        ",
    ),
    NexyIconName.Fork to listOf(
        "   ##   ", "## ## ##", "## ## ##", " ###### ",
        "   ##   ", "   ##   ", "  ####  ", "        ",
    ),
    NexyIconName.Expand to listOf(
        "###  ###", "#      #", "#      #", "        ",
        "        ", "#      #", "#      #", "###  ###",
    ),
    NexyIconName.Image to listOf(
        "########", "#      #", "# ##   #", "# ##   #",
        "#    # #", "#  ##  #", "########", "        ",
    ),
    NexyIconName.Home to listOf(
        "   ##   ", "  ####  ", " ##  ## ", "##    ##",
        "########", "## ## ##", "##    ##", "        ",
    ),
    NexyIconName.Import to listOf(
        "########", "#      #", "#  ##  #", "# #### #",
        "#  ##  #", "#  ##  #", "########", "        ",
    ),
    NexyIconName.Inbox to listOf(
        "        ", " ##  ## ", " ##  ## ", " ##  ## ",
        "###  ###", "## ## ##", " ###### ", "        ",
    ),
    NexyIconName.Inspect to listOf(
        "        ", "  ####  ", " ##  ## ", "## ## ##",
        "## ## ##", " ##  ## ", "  ####  ", "        ",
    ),
    NexyIconName.Microphone to listOf(
        "  ####  ", "  #  #  ", "  #  #  ", "# #  # #",
        "# #### #", " ##  ## ", "   ##   ", "  ####  ",
    ),
    NexyIconName.More to listOf(
        "        ", "   ##   ", "   ##   ", "        ",
        "   ##   ", "   ##   ", "        ", "   ##   ",
    ),
    NexyIconName.Pause to listOf(
        "        ", " ##  ## ", " ##  ## ", " ##  ## ",
        " ##  ## ", " ##  ## ", " ##  ## ", "        ",
    ),
    NexyIconName.Pin to listOf(
        "  ####  ", "########", "  ####  ", "   ##   ",
        "   ##   ", "   ##   ", "   ##   ", "        ",
    ),
    NexyIconName.Play to listOf(
        " ##     ", " ####   ", " ###### ", " #######",
        " ###### ", " ####   ", " ##     ", "        ",
    ),
    NexyIconName.Project to listOf(
        "        ", " ###    ", " # #### ", " #    # ",
        " #    # ", " #    # ", " ###### ", "        ",
    ),
    NexyIconName.Prompt to listOf(
        "######  ", "#    #  ", "# ## #  ", "#    #  ",
        "# ## #  ", "#    #  ", "######  ", "        ",
    ),
    NexyIconName.Rating to listOf(
        "   ##   ", "   ##   ", " ###### ", "  ####  ",
        "  ####  ", " ##  ## ", " ##  ## ", "        ",
    ),
    NexyIconName.Refresh to listOf(
        "  ######", " ##     ", "##      ", "##   ###",
        "###   ##", "     ## ", "######  ", "        ",
    ),
    NexyIconName.Scan to listOf(
        " ### ###", " #     #", " #     #", "        ",
        "        ", " #     #", " #     #", "### ### ",
    ),
    // Clock face with a counter-clockwise arrow head at the upper left: "look back in time".
    NexyIconName.History to listOf(
        "  ####  ", "##    # ", "## #   #", "   #   #",
        "#  ### #", " #    # ", "  ####  ", "        ",
    ),
    NexyIconName.Scheduled to listOf(
        " ##  ## ", "########", "#      #", "# ###  #",
        "#   #  #", "#   ### ", "########", "        ",
    ),
    NexyIconName.Search to listOf(
        "  ####  ", " ##  ## ", " ##  ## ", " ##  ## ",
        "  ####  ", "    ##  ", "     ## ", "        ",
    ),
    NexyIconName.Send to listOf(
        "#       ", "###     ", "######  ", "########",
        "######  ", "###     ", "#       ", "        ",
    ),
    NexyIconName.Share to listOf(
        "     ###", "    ####", "####  ##", "#  #    ",
        "####  ##", "    ####", "     ###", "        ",
    ),
    NexyIconName.Settings to listOf(
        "   ##   ", " ##  ## ", "## ## ##", "  ####  ",
        "  ####  ", "## ## ##", " ##  ## ", "   ##   ",
    ),
    NexyIconName.Skill to listOf(
        "##    ##", " ##  ## ", "  ####  ", "   ##   ",
        "  ####  ", " ##  ## ", "##    ##", "        ",
    ),
    NexyIconName.Spark to listOf(
        "   ##   ", "   ##   ", "  ####  ", "########",
        "  ####  ", "   ##   ", "   ##   ", "        ",
    ),
    NexyIconName.Stop to listOf(
        "        ", " ###### ", " ###### ", " ###### ",
        " ###### ", " ###### ", " ###### ", "        ",
    ),
    NexyIconName.Tool to listOf(
        "##    ##", " ##  ## ", "  ####  ", "   ##   ",
        "   ##   ", "  ####  ", "  ####  ", "        ",
    ),
    NexyIconName.Download to listOf(
        "   ##   ", "   ##   ", "   ##   ", "## ## ##",
        " ###### ", "  ####  ", "########", "        ",
    ),
    NexyIconName.Upload to listOf(
        "  ####  ", " ###### ", "## ## ##", "   ##   ",
        "   ##   ", "   ##   ", "########", "        ",
    ),
    NexyIconName.Workflow to listOf(
        "###  ###", "# #  # #", "###  ###", "  ####  ",
        "  ####  ", "###  ###", "# #  # #", "###  ###",
    ),
    NexyIconName.Warning to listOf(
        "   ##   ", "  ####  ", "  ####  ", " ##  ## ",
        " ##  ## ", "##    ##", "########", "        ",
    ),
)

@Composable
fun NexyIcon(
    name: NexyIconName,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
    motion: NexyIconMotion = NexyIconMotion.Default,
) {
    if (!LocalNexyEightBit.current) {
        val classicModifier = if (name == NexyIconName.Busy && motion != NexyIconMotion.None) {
            val transition = rememberInfiniteTransition(label = "classic-busy-icon")
            val rotation by transition.animateFloat(
                initialValue = 0f,
                targetValue = 360f,
                animationSpec = infiniteRepeatable(tween(1_000, easing = LinearEasing)),
                label = "classic-busy-rotation",
            )
            modifier.graphicsLayer(rotationZ = rotation)
        } else {
            modifier
        }
        Icon(
            imageVector = classicIcon(name),
            contentDescription = contentDescription,
            modifier = classicModifier.size(24.dp),
            tint = tint,
        )
        return
    }
    val density = LocalDensity.current
    val retroMotionEnabled = name == NexyIconName.Busy &&
        motion != NexyIconMotion.None &&
        !LocalInspectionMode.current &&
        ValueAnimator.areAnimatorsEnabled()
    val retroTransition = if (retroMotionEnabled) {
        rememberInfiniteTransition(label = "retro-busy-icon")
    } else {
        null
    }
    val retroAlpha = if (retroMotionEnabled && motion != NexyIconMotion.Spin) {
        val alpha by retroTransition!!.animateFloat(
            initialValue = 1f,
            targetValue = 0.58f,
            animationSpec = infiniteRepeatable(
                animation = tween(1_200, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse,
            ),
            label = "retro-busy-alpha",
        )
        alpha
    } else {
        1f
    }
    val retroRotation = if (retroMotionEnabled && motion == NexyIconMotion.Spin) {
        val rotation by retroTransition!!.animateFloat(
            initialValue = 0f,
            targetValue = 360f,
            animationSpec = infiniteRepeatable(tween(1_000, easing = LinearEasing)),
            label = "retro-busy-rotation",
        )
        rotation
    } else {
        0f
    }
    val semanticModifier = if (contentDescription == null) {
        modifier
    } else {
        modifier.semantics { this.contentDescription = contentDescription }
    }
    Canvas(modifier = semanticModifier.graphicsLayer(alpha = retroAlpha, rotationZ = retroRotation).size(24.dp)) {
        drawPattern(patterns.getValue(name), tint, density.density)
    }
}

private fun classicIcon(name: NexyIconName): ImageVector = when (name) {
    NexyIconName.Add -> Icons.Filled.Add
    NexyIconName.Agent -> Icons.Filled.SmartToy
    NexyIconName.Archive -> Icons.Filled.Archive
    NexyIconName.Artifact -> Icons.Filled.Inventory2
    NexyIconName.Attach -> Icons.Filled.AttachFile
    NexyIconName.Busy -> Icons.Filled.Refresh
    NexyIconName.Check -> Icons.Filled.Check
    NexyIconName.CheckedBox -> Icons.Filled.CheckBox
    NexyIconName.ChevronDown -> Icons.Filled.KeyboardArrowDown
    NexyIconName.ChevronRight -> Icons.Filled.KeyboardArrowRight
    NexyIconName.ChevronUp -> Icons.Filled.KeyboardArrowUp
    NexyIconName.Close -> Icons.Filled.Close
    NexyIconName.Copy -> Icons.Filled.ContentCopy
    NexyIconName.Compress -> Icons.Filled.Compress
    NexyIconName.Delete -> Icons.Filled.Delete
    NexyIconName.Edit -> Icons.Filled.Edit
    NexyIconName.Error -> Icons.Filled.Error
    NexyIconName.File -> Icons.Filled.InsertDriveFile
    NexyIconName.Folder -> Icons.Filled.Folder
    NexyIconName.Fork -> Icons.Filled.CallSplit
    NexyIconName.Expand -> Icons.Filled.OpenInFull
    NexyIconName.Image -> Icons.Filled.Image
    NexyIconName.Home -> Icons.Filled.Home
    NexyIconName.Inbox -> Icons.Filled.Inbox
    NexyIconName.Import -> Icons.Filled.FileDownload
    NexyIconName.Inspect -> Icons.Filled.Search
    NexyIconName.Microphone -> Icons.Filled.Mic
    NexyIconName.More -> Icons.Filled.MoreVert
    NexyIconName.Pause -> Icons.Filled.Pause
    NexyIconName.Pin -> Icons.Filled.PushPin
    NexyIconName.Play -> Icons.Filled.PlayArrow
    NexyIconName.Project -> Icons.Filled.Work
    NexyIconName.Prompt -> Icons.Filled.Article
    NexyIconName.Rating -> Icons.Filled.Star
    NexyIconName.Refresh -> Icons.Filled.Refresh
    NexyIconName.Scan -> Icons.Filled.QrCodeScanner
    NexyIconName.History -> Icons.Filled.History
    NexyIconName.Scheduled -> Icons.Filled.Schedule
    NexyIconName.Search -> Icons.Filled.Search
    NexyIconName.Send -> Icons.AutoMirrored.Filled.Send
    NexyIconName.Share -> Icons.Filled.Share
    NexyIconName.Settings -> Icons.Filled.Settings
    NexyIconName.Skill -> Icons.Filled.Extension
    NexyIconName.Spark -> Icons.Filled.AutoAwesome
    NexyIconName.Stop -> Icons.Filled.Stop
    NexyIconName.Tool -> Icons.Filled.Build
    NexyIconName.Download -> Icons.Filled.Download
    NexyIconName.Upload -> Icons.Filled.Upload
    NexyIconName.Workflow -> Icons.Filled.AccountTree
    NexyIconName.Warning -> Icons.Filled.Warning
}

private fun DrawScope.drawPattern(pattern: List<String>, color: Color, density: Float) {
    val gridSize = pattern.size.toFloat()
    val pixelSize = minOf(size.width, size.height) / gridSize
    val snappedPixelSize = (pixelSize * density).toInt().coerceAtLeast(1) / density
    val width = snappedPixelSize * gridSize
    val origin = Offset((size.width - width) / 2f, (size.height - width) / 2f)
    pattern.forEachIndexed { y, row ->
        row.forEachIndexed { x, cell ->
            if (cell == '#') {
                drawRect(
                    color = color,
                    topLeft = Offset(origin.x + x * snappedPixelSize, origin.y + y * snappedPixelSize),
                    size = Size(snappedPixelSize, snappedPixelSize),
                )
            }
        }
    }
}

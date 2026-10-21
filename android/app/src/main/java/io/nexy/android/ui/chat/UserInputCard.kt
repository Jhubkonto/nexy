package io.nexy.android.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.nexy.android.data.WsRepository
import io.nexy.android.ui.theme.NexyChatSurfaceShape

@Composable
fun UserInputCard(input: ChatTurnUserInput) {
    var selected by remember(input.requestId) { mutableStateOf<Map<String, Set<String>>>(emptyMap()) }
    var texts by remember(input.requestId) { mutableStateOf<Map<String, String>>(emptyMap()) }
    val resolved = input.answers.associateBy { it.questionId }
    val pending = input.status == "pending"
    val complete = input.questions.all { question ->
        !selected[question.id].isNullOrEmpty() || !texts[question.id].isNullOrBlank()
    }

    Surface(
        shape = NexyChatSurfaceShape,
        color = MaterialTheme.colorScheme.primaryContainer,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("A little more information is needed", style = MaterialTheme.typography.titleSmall)
            input.questions.forEach { question ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    question.header?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary) }
                    Text(question.prompt, style = MaterialTheme.typography.bodyMedium)
                    question.options.forEach { option ->
                        val current = if (pending) selected[question.id].orEmpty() else resolved[question.id]?.selectedOptionIds.orEmpty().toSet()
                        val checked = option.id in current
                        Row(verticalAlignment = Alignment.Top) {
                            if (question.selection == "multiple") {
                                Checkbox(checked = checked, enabled = pending, onCheckedChange = {
                                    selected = selected + (question.id to if (checked) current - option.id else current + option.id)
                                })
                            } else {
                                RadioButton(selected = checked, enabled = pending, onClick = {
                                    selected = selected + (question.id to setOf(option.id))
                                })
                            }
                            Column(Modifier.padding(top = 10.dp)) {
                                Text(option.label, style = MaterialTheme.typography.bodyMedium)
                                option.description?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                            }
                        }
                    }
                    if (question.allowFreeText) {
                        OutlinedTextField(
                            value = if (pending) texts[question.id].orEmpty() else resolved[question.id]?.text.orEmpty(),
                            onValueChange = { texts = texts + (question.id to it) },
                            enabled = pending,
                            label = { Text("Your answer") },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
            if (pending) {
                Button(
                    enabled = complete,
                    onClick = {
                        WsRepository.respondToUserInput(input.requestId, input.questions.map { question ->
                            UserInputAnswer(question.id, selected[question.id].orEmpty().toList(), texts[question.id]?.trim())
                        })
                    },
                ) { Text("Submit") }
            } else {
                Text(if (input.status == "resolved") "Answered" else input.reason ?: "Cancelled", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

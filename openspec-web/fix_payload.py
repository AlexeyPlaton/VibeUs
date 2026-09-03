import os, re

path = 'src/components/widget/hooks/usewidgetstate.ts'
if not os.path.exists(path):
    path = 'src/components/widget/hooks/useWidgetState.ts'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Удаляем лишнее поле status из payload
content = re.sub(r"category:\s*'idea',\s*status:\s*'new'", "category: 'idea'", content)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Payload исправлен!')

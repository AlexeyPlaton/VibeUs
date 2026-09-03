with open('src/pages/landingpage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('Github,', '')
content = content.replace('<Github size={17} />', '<GitBranch size={17} />')

with open('src/pages/landingpage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Иконка успешно заменена!')

import os

path = 'src/pages/createprojectpage.tsx'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Проверяем именно по наличию getItem, чтобы не обмануть себя снова
if "getItem('vibus_saved_result')" not in content:
    content = content.replace(
        "window.location.assign(data.confirmation_url);",
        "sessionStorage.setItem('vibus_saved_result', JSON.stringify(result));\n      window.location.assign(data.confirmation_url);"
    )
    
    target = "const [billingError, setBillingError] = useState<string | null>(null);"
    hook_code = '''
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('payment') === 'return') {
      const saved = sessionStorage.getItem('vibus_saved_result');
      if (saved) {
        setResult(JSON.parse(saved));
        sessionStorage.removeItem('vibus_saved_result');
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, []);
'''
    content = content.replace(target, target + "\n" + hook_code)
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Вот теперь точно исправлено! 🚀")
else:
    print("Уже исправлено.")

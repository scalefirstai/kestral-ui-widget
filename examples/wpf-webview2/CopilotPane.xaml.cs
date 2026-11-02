// .NET desktop (WPF; WinForms is identical with Microsoft.Web.WebView2.WinForms).
// Hosts the same pure-JS widget in a WebView2 side pane. The widget asks the host for a token
// and the current screen context over postMessage; the host answers from .NET.
//
// NuGet: Microsoft.Web.WebView2
// XAML:  <wv2:WebView2 x:Name="CopilotView" />
using System;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;

namespace Fis.Desktop.Copilot
{
    public partial class CopilotPane : UserControl
    {
        private readonly string _gatewayUrl;
        private readonly string _appId;
        private readonly Func<Task<string?>> _getToken;          // e.g. MSAL AcquireTokenSilent for the copilot scope
        private readonly Func<object> _getContext;               // e.g. () => new { screen = "Trade Blotter", fundId = vm.FundId }

        public CopilotPane(string gatewayUrl, string appId, Func<Task<string?>> getToken, Func<object> getContext)
        {
            InitializeComponent();
            _gatewayUrl = gatewayUrl.TrimEnd('/');
            _appId = appId;
            _getToken = getToken;
            _getContext = getContext;
            Loaded += async (_, __) => await InitAsync();
        }

        private async Task InitAsync()
        {
            await CopilotView.EnsureCoreWebView2Async();
            var core = CopilotView.CoreWebView2;

            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.WebMessageReceived += OnWebMessage;

            // Serve the page from a stable https origin so the gateway CORS allowlist can name it:
            // add "https://copilot.desktop" to ALLOWED_ORIGINS.
            var folder = System.IO.Path.Combine(AppContext.BaseDirectory, "copilot");
            System.IO.Directory.CreateDirectory(folder);
            System.IO.File.WriteAllText(System.IO.Path.Combine(folder, "index.html"), BuildPage());
            core.SetVirtualHostNameToFolderMapping("copilot.desktop", folder,
                CoreWebView2HostResourceAccessKind.DenyCors);

            // Block navigation away from the copilot page; open links in the user's browser instead.
            core.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var u) && (u.Scheme == "https"))
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(u.ToString()) { UseShellExecute = true });
            };

            CopilotView.CoreWebView2.Navigate("https://copilot.desktop/index.html");
        }

        private string BuildPage() => $@"<!doctype html><html><head><meta charset='utf-8'>
<style>html,body{{margin:0;height:100%}}#c{{height:100%}}</style>
<script src='{_gatewayUrl}/widget/fis-copilot.js'></script></head>
<body><div id='c'></div><script>
FisCopilot.init({{ gatewayUrl: '{_gatewayUrl}', appId: '{_appId}', container: '#c' }});
</script></body></html>";

        // Widget -> host: { type: 'fis-copilot:request', id, method: 'getToken' | 'getContext' }
        // Host -> widget: { type: 'fis-copilot:response', id, result }
        private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            if (root.GetProperty("type").GetString() != "fis-copilot:request") return;

            var id = root.GetProperty("id").GetString();
            object? result = root.GetProperty("method").GetString() switch
            {
                "getToken" => await _getToken(),
                "getContext" => _getContext(),
                _ => null
            };

            CopilotView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
            {
                type = "fis-copilot:response",
                id,
                result
            }));
        }
    }
}

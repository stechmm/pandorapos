using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

internal static class PandoraPosLauncher
{
    private const int Port = 4173;

    [STAThread]
    private static void Main()
    {
        string appDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string serverPath = Path.Combine(appDir, "server.js");

        if (!File.Exists(serverPath))
        {
            MessageBox.Show("server.js was not found. Keep this launcher inside the Pandora POS app folder.", "Pandora POS");
            return;
        }

        string pcUrl = "http://localhost:" + Port;
        string[] lanUrls = GetLanAddresses().Select(address => "http://" + address + ":" + Port).ToArray();

        if (!IsServerReady(pcUrl))
        {
            StartServer(appDir, serverPath);
            WaitForServer(pcUrl);
        }

        OpenBrowser(pcUrl);

        string phoneUrl = lanUrls.FirstOrDefault() ?? pcUrl;
        try
        {
            Clipboard.SetText(phoneUrl);
        }
        catch
        {
            // Clipboard can be blocked by policy; the MessageBox still shows the URL.
        }

        MessageBox.Show(
            "Pandora POS has started.\n\n" +
            "Cashier PC: " + pcUrl + "\n" +
            "Phone/Tablet: " + phoneUrl + "\n\n" +
            "Connect the phone/tablet to the same Wi-Fi and open the Phone/Tablet URL.\n" +
            "The Phone/Tablet URL has been copied to the clipboard.",
            "Pandora POS"
        );
    }

    private static void StartServer(string appDir, string serverPath)
    {
        string nodePath = FindNode();
        if (string.IsNullOrWhiteSpace(nodePath))
        {
            MessageBox.Show("Node.js was not found. Install Node.js 20 or newer to run Pandora POS.", "Pandora POS");
            Environment.Exit(1);
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = nodePath,
            Arguments = "\"" + serverPath + "\"",
            WorkingDirectory = appDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };

        Process.Start(startInfo);
    }

    private static string FindNode()
    {
        string[] candidates =
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe")
        };

        foreach (string candidate in candidates)
        {
            if (File.Exists(candidate)) return candidate;
        }

        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string folder in path.Split(Path.PathSeparator))
        {
            try
            {
                string candidate = Path.Combine(folder.Trim(), "node.exe");
                if (File.Exists(candidate)) return candidate;
            }
            catch
            {
                // Ignore malformed PATH entries.
            }
        }

        return null;
    }

    private static bool WaitForServer(string url)
    {
        for (int i = 0; i < 30; i++)
        {
            if (IsServerReady(url)) return true;
            Thread.Sleep(200);
        }
        return false;
    }

    private static bool IsServerReady(string url)
    {
        try
        {
            var request = WebRequest.Create(url + "/api/index.php?action=status");
            request.Timeout = 700;
            using (var response = request.GetResponse())
            {
                return ((HttpWebResponse)response).StatusCode == HttpStatusCode.OK;
            }
        }
        catch
        {
            return false;
        }
    }

    private static void OpenBrowser(string url)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true
        });
    }

    private static string[] GetLanAddresses()
    {
        return NetworkInterface.GetAllNetworkInterfaces()
            .Where(item => item.OperationalStatus == OperationalStatus.Up)
            .SelectMany(item => item.GetIPProperties().UnicastAddresses)
            .Where(item => item.Address.AddressFamily == AddressFamily.InterNetwork)
            .Select(item => item.Address.ToString())
            .Where(address => !address.StartsWith("127."))
            .Distinct()
            .ToArray();
    }
}

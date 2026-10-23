import { createHash } from 'node:crypto';
import { readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const xml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const id = (name) => `id${createHash('sha256').update(name).digest('hex').slice(0, 28)}`;
const guid = (name) => {
  const hash = createHash('sha256').update(`NSWFireCoverage:${name}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`.toUpperCase();
};

export async function generateWxs({ payload, outputFile, version }) {
  const componentIds = [];
  async function directory(path, directoryId, name) {
    let body = '';
    const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(path, entry.name);
      const key = relative(payload, full).replaceAll('\\', '/');
      if (entry.isDirectory()) body += await directory(full, id(`directory:${key}`), entry.name);
      else if (entry.isFile()) {
        const component = id(`component:${key}`);
        componentIds.push(component);
        const service = key === 'NSWFireCoverage.exe' ? `
          <ServiceInstall Id="InstallCheckerService" Name="NSWFireCoverage" DisplayName="NSW Fire Coverage"
            Description="Locally hosted NSW Fire Coverage checker and scheduled RFS updater."
            Type="ownProcess" Start="auto" ErrorControl="normal" Vital="yes" Account="NT AUTHORITY\\LocalService" />
          <ServiceControl Id="ControlCheckerService" Name="NSWFireCoverage" Start="install" Stop="both" Remove="uninstall" Wait="yes" />` : '';
        body += `<Component Id="${component}" Guid="${guid(key)}" Win64="yes">
          <File Id="${id(`file:${key}`)}" Source="${xml(`payload/${key}`)}" Name="${xml(entry.name)}" KeyPath="yes" />${service}
        </Component>`;
      }
    }
    return `<Directory Id="${directoryId}" Name="${xml(name)}">${body}</Directory>`;
  }
  const installation = await directory(payload, 'INSTALLFOLDER', 'NSW Fire Coverage');
  componentIds.push('PersistentData', 'StartMenuShortcut');
  const content = `<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="NSW Fire Coverage" Language="1033" Version="${xml(version)}"
    Manufacturer="NSW Fire Coverage" UpgradeCode="CC0EDCD7-C8C3-4B34-8E9E-12E3C286A610">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine"
      Description="Self-hosted NSW Fire Coverage checker" />
    <Media Id="1" Cabinet="NSWFireCoverage.cab" EmbedCab="yes" />
    <MajorUpgrade AllowSameVersionUpgrades="yes" DowngradeErrorMessage="A newer NSW Fire Coverage version is installed." />
    <Property Id="ARPCOMMENTS" Value="Self-hosted Windows service. No Replit runtime dependencies." />
    <Property Id="WINDOWSBUILD">
      <RegistrySearch Id="DetectWindowsBuild" Root="HKLM" Key="SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" Name="CurrentBuildNumber" Type="raw" Win64="yes" />
    </Property>
    <Property Id="NETFRAMEWORKRELEASE">
      <RegistrySearch Id="DetectNetFramework" Root="HKLM" Key="SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full" Name="Release" Type="raw" Win64="yes" />
    </Property>
    <Condition Message="This installer requires Windows 10 x64 or Windows Server 2022 x64 (or newer).">
      Installed OR (VersionNT64 AND ((MsiNTProductType = 1 AND WINDOWSBUILD &gt;= 10240) OR (MsiNTProductType &lt;&gt; 1 AND WINDOWSBUILD &gt;= 20348)))
    </Condition>
    <Condition Message="The built-in .NET Framework 4.6.1 or newer is required for the service wrapper. Windows Server 2022 includes it.">
      Installed OR NETFRAMEWORKRELEASE &gt;= "#394254"
    </Condition>
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">${installation}</Directory>
      <Directory Id="CommonAppDataFolder">
        <Directory Id="DATAFOLDER" Name="NSW Fire Coverage">
          <Component Id="PersistentData" Guid="${guid('persistent-data')}" Win64="yes" Permanent="yes">
            <CreateFolder />
          </Component>
        </Directory>
      </Directory>
      <Directory Id="ProgramMenuFolder">
        <Directory Id="ProgramMenuDir" Name="NSW Fire Coverage">
          <Component Id="StartMenuShortcut" Guid="${guid('start-menu')}" Win64="yes">
            <Shortcut Id="OpenChecker" Name="NSW Fire Coverage" Target="[INSTALLFOLDER]Open Checker.url" WorkingDirectory="INSTALLFOLDER" />
            <RemoveFolder Id="RemoveMenu" On="uninstall" />
            <RegistryValue Root="HKLM" Key="Software\\NSWFireCoverage" Name="Installed" Type="integer" Value="1" KeyPath="yes" />
          </Component>
        </Directory>
      </Directory>
    </Directory>
    <CustomAction Id="SetIcaclsPath" Property="IcaclsPath" Value="[System64Folder]icacls.exe" />
    <CustomAction Id="GrantLocalServiceDataAccess" Property="IcaclsPath"
      ExeCommand="&quot;[DATAFOLDER].&quot; /grant *S-1-5-19:(OI)(CI)M /T /Q"
      Execute="deferred" Impersonate="no" Return="check" />
    <CustomAction Id="SetScPath" Property="ScExePath" Value="[System64Folder]sc.exe" />
    <CustomAction Id="ConfigureServiceRecovery" Property="ScExePath"
      ExeCommand="failure NSWFireCoverage reset= 3600 actions= restart/10000/restart/30000/restart/60000"
      Execute="deferred" Impersonate="no" Return="check" />
    <CustomAction Id="ConfigureServiceFailureFlag" Property="ScExePath"
      ExeCommand="failureflag NSWFireCoverage 1"
      Execute="deferred" Impersonate="no" Return="check" />
    <InstallExecuteSequence>
      <Custom Action="SetIcaclsPath" After="InstallFiles">NOT REMOVE~="ALL"</Custom>
      <Custom Action="GrantLocalServiceDataAccess" After="SetIcaclsPath">NOT REMOVE~="ALL"</Custom>
      <Custom Action="SetScPath" After="InstallServices">NOT REMOVE~="ALL"</Custom>
      <Custom Action="ConfigureServiceRecovery" After="SetScPath">NOT REMOVE~="ALL"</Custom>
      <Custom Action="ConfigureServiceFailureFlag" After="ConfigureServiceRecovery">NOT REMOVE~="ALL"</Custom>
    </InstallExecuteSequence>
    <Feature Id="Complete" Title="NSW Fire Coverage" Level="1">
      ${componentIds.map((component) => `<ComponentRef Id="${component}" />`).join('\n      ')}
    </Feature>
  </Product>
</Wix>
`;
  await writeFile(outputFile, content);
}

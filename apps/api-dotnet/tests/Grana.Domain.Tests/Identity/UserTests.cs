using Grana.Domain.Common;
using Grana.Domain.Identity;

namespace Grana.Domain.Tests.Identity;

/// <summary>Agregado de identidade e e-mail — user.entity.ts e email.vo.ts (RN-030–062).</summary>
public class UserTests
{
    private static readonly DateTime Now = new(2026, 10, 29, 12, 0, 0, DateTimeKind.Utc);

    private static User NewUser(UserRole role = UserRole.User, UserStatus status = UserStatus.Active) =>
        User.Create("u1", "  Ana Souza  ", EmailAddress.Create("ana@grana.app"), "hash", role, status, mustChangePassword: true, Now);

    [Theory]
    [InlineData("  ANA@Grana.App ", "ana@grana.app")]
    [InlineData("a.b+c@sub.dominio.com.br", "a.b+c@sub.dominio.com.br")]
    public void Email_aparado_e_em_minusculas(string raw, string expected) =>
        Assert.Equal(expected, EmailAddress.Create(raw).Value);

    [Theory]
    [InlineData("sem-arroba")]
    [InlineData("a@b.c")]
    [InlineData("a b@c.com")]
    [InlineData("a@b c.com")]
    [InlineData("a@@b.com")]
    public void Email_invalido_e_erro_de_validacao_com_details(string raw)
    {
        var error = Assert.Throws<ValidationError>(() => EmailAddress.Create(raw));
        Assert.Equal(("E-mail inválido.", "VALIDATION_ERROR"), (error.Message, error.Code));
        Assert.Equal([("email", "E-mail inválido.")], error.Details!);
    }

    [Fact]
    public void Email_acima_de_160_caracteres_e_recusado() =>
        Assert.Throws<ValidationError>(() => EmailAddress.Create($"{new string('a', 151)}@grana.app"));

    [Fact]
    public void Cria_com_nome_aparado_e_sem_falhas()
    {
        var user = NewUser();
        Assert.Equal(("Ana Souza", "ana@grana.app", 0, (DateTime?)null, Now, Now), (user.Name, user.Email.ToString(), user.FailedLoginAttempts, user.LastLoginAt, user.CreatedAt, user.UpdatedAt));
        Assert.True(user.MustChangePassword && user.IsActive && !user.IsAdmin);
    }

    [Fact]
    public void Quinta_falha_bloqueia_por_15_minutos_e_zera_o_contador()
    {
        var user = NewUser();
        for (var attempt = 1; attempt <= 4; attempt++) user.RegisterFailedLogin(Now);
        Assert.Equal((4, false), (user.FailedLoginAttempts, user.IsLocked(Now)));

        user.RegisterFailedLogin(Now);
        Assert.Equal((0, true, Now.AddMinutes(15)), (user.FailedLoginAttempts, user.IsLocked(Now), user.LockedUntil!.Value));
        Assert.Equal(61, user.LockRemainingSeconds(Now.AddMinutes(14).AddMilliseconds(-500)));
        Assert.False(user.IsLocked(Now.AddMinutes(15)));
        Assert.Equal(0, user.LockRemainingSeconds(Now.AddMinutes(16)));

        user.RegisterSuccessfulLogin(Now.AddMinutes(20));
        Assert.Equal((0, (DateTime?)null, (DateTime?)Now.AddMinutes(20)), (user.FailedLoginAttempts, user.LockedUntil, user.LastLoginAt));
    }

    [Fact]
    public void Renomear_trocar_email_senha_perfil_e_status()
    {
        var user = NewUser();
        Assert.Equal("O nome precisa ter ao menos 2 caracteres.", Assert.Throws<BusinessRuleError>(() => user.Rename("  a ", Now)).Message);
        user.Rename(" Bia ", Now);
        user.ChangeEmail(EmailAddress.Create("bia@grana.app"), Now);
        user.RegisterFailedLogin(Now);
        user.ChangePassword("novo", mustChangePassword: false, Now.AddSeconds(1));
        Assert.Equal(("Bia", "bia@grana.app", "novo", false, 0, Now.AddSeconds(1)), (user.Name, user.Email.Value, user.PasswordHash, user.MustChangePassword, user.FailedLoginAttempts, user.UpdatedAt));

        user.ChangeRole(UserRole.Admin, Now);
        user.Suspend(Now);
        Assert.Equal((true, UserStatus.Suspended), (user.IsAdmin, user.Status));
        user.Activate(Now);
        Assert.Equal(UserStatus.Active, user.Status);
        user.Touch(Now.AddHours(1));
        Assert.Equal(Now.AddHours(1), user.UpdatedAt);
    }

    [Fact]
    public void Nao_pode_na_propria_conta_com_o_da_a_do_Node()
    {
        var user = NewUser();
        user.AssertIsNotSelf("outro", "excluir");
        Assert.Equal("Você não pode alterar o perfil da a própria conta.", Assert.Throws<ForbiddenError>(() => user.AssertIsNotSelf("u1", "alterar o perfil da")).Message);
    }

    [Fact]
    public void Texto_com_a_semantica_do_JavaScript()
    {
        Assert.Equal("a b", JsText.Trim(" ﻿ a b 　"));
        Assert.Equal(("abc", "ab", null), (JsText.Slice("abc", 5), JsText.Slice("abc", 2), JsText.Slice(null, 2)));
    }
}
